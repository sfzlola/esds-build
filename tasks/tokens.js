'use strict';

const config = require('./config.js'),
        gulp = config.getGulpInstance(),
        c = config.get(),
        flatten = require('flat'),
        fs = require('fs'),
        path = require('path'),
        jsBeautify = require('js-beautify'),
        mkdirp = require('mkdirp'),
        yaml = require('yamljs'),
        tap = require('gulp-tap'),
        tokenConfig = c.tokens;

function generateBasePreAndPostTasks(taskName) {
    const tasksWithPreAndPostHooks = config.getBaseTaskWithPreAndPostHooks(taskName);
    gulp.task(taskName, gulp.series(tasksWithPreAndPostHooks)); // Calls :base task and pre: and post: tasks if defined
}

function tokensToJson(sourceFile) {
    let tokens = {},
        parsedTokens;
    try {
        let rawYaml = fs.readFileSync(sourceFile, 'UTF-8');
        let interpolatedYaml = interpolateYamlVariables(rawYaml);
        parsedTokens = yaml.parse(interpolatedYaml);
        if (parsedTokens !== null && typeof parsedTokens === 'object') {
            tokens = parsedTokens;
        }
    } catch (e) {
        // eslint-disable-next-line no-console
        console.log(e, `Warning: Could not parse tokens file ${sourceFile} into JSON`);
    }
    return tokens;
}

function traceTokenReferenceToValue(value, rawYaml) {
  const referenceRegex = /\*(.*)/gm;
  let m;
  m = referenceRegex.exec(value);
  if (m === null) {
    return value;
  } else {
    const match = m[1];
    const searchRegex = new RegExp(`\&${match} (.*)`, 'gm');
    m = searchRegex.exec(rawYaml);
    if (m === null) {
      return `CANNOT FIND VALUE FOR ${match}`;
    } else {
      const nextMatch = m[1];
      return traceTokenReferenceToValue(nextMatch, rawYaml);
    }
  }
}

function interpolateYamlVariables(rawYaml) {

  const AnchorRegex = /\&(\S*) (.*)/gm;
  let m;
  const anchorReplacements = {};

  while ((m = AnchorRegex.exec(rawYaml)) !== null) {
      // This is necessary to avoid infinite loops with zero-width matches
      if (m.index === AnchorRegex.lastIndex) {
          AnchorRegex.lastIndex++;
      }

      // The result can be accessed through the `m`-variable.
      const replacementKey = m[1];
      const replacementValue = m[2];
      anchorReplacements[replacementKey] = traceTokenReferenceToValue(replacementValue, rawYaml);
  }

  const ReferenceRegex = /!\{\*\S*\}/;
  while ((m = ReferenceRegex.exec(rawYaml)) !== null) {
    // This is necessary to avoid infinite loops with zero-width matches
    if (m.index === ReferenceRegex.lastIndex) {
        ReferenceRegex.lastIndex++;
    }

    m.forEach((match, groupIndex) => {
      const replacementKey = match.replace(/!|\{|\*|\}/g, '');
      let replacement = anchorReplacements[replacementKey];
      replacement = replacement.replace(/^"|"$/g, ''); // Remove double quotes from beginning and end of value
      rawYaml = rawYaml.replace(match, replacement);
    });
  }

  return rawYaml;
}

function tokensSourceFileExists(sourceFile) {
    if (fs.existsSync(sourceFile)) {
        return true;
    } else {
        // eslint-disable-next-line no-console
        console.log(`Warning: ${sourceFile} cannot be found, token files not built`);
        return false;
    }
}

function writeTokensJsonFile(tokens, yamlFileName) {
    const jsonOutputFilename = path.parse(yamlFileName).name + '.json',
            jsonOutputFilepath = path.join(c.rootPath, c.tokensPath, jsonOutputFilename),
            tokensSuffix = path.parse(yamlFileName).name;

    let jsonTokens = {};
        jsonTokens[`${c.codeNamespace.replace(/-/g, '_')}_${tokensSuffix}`] = tokens;

    // JSON tokens
    if (!fs.existsSync(tokenConfig.outputPath)) {
        mkdirp.sync(tokenConfig.outputPath);
    }

    fs.writeFileSync(jsonOutputFilepath, jsBeautify(JSON.stringify(jsonTokens)));
}

function getTokensScssMap(tokens, yamlFileName) {
    let tokensSuffix = path.parse(yamlFileName).name,
        sassMap = `$${tokenConfig.namespace}-${tokensSuffix.replace(/_/g, '-')}: (\n`,
        indentationLevel = 1,
        variablePrefix = `$${tokenConfig.namespace}-`;

    sassMap += generateScssMapSection(tokens, indentationLevel, variablePrefix);
    sassMap += ');\n';
    return sassMap;
}

function getIndentationString(indentationLevel) {
    let indentation = '';
    for (var i = 0; i < indentationLevel; i++) {
        indentation += '    ';
    }

    return indentation;
}

function generateScssMapSection(node, indentationLevel, variablePrefix) {
    let output = '',
        indentation = getIndentationString(indentationLevel);
    for (var key in node) {
        let value = node[key],
            prefix = `${variablePrefix}${key}-`;

        if (typeof value === 'object') {
            value = generateScssMapSection(value, indentationLevel + 1, prefix);
            output += `${indentation}'${key}': (\n`;
            output += value;
            output += `${indentation}),\n`;
        } else {
            output += `${indentation}'${key}': ${variablePrefix}${key},\n`;
        }
    }

    output = output.replace(/,\n$/, '\n');

    return output;
}

function writeTokensScssFile(tokens, yamlFileName) {
    const scssOutputFilename = path.parse(yamlFileName).name + '.scss',
            scssOutputFilepath = path.join(c.rootPath, c.tokensPath, scssOutputFilename),
            scssMap = getTokensScssMap(tokens, yamlFileName);
    let flattenedTokens = flatten(tokens, {delimiter: '-'}),
        scss = `// DO NOT EDIT: This file is automatically generated by a build task\n\n`,
        prevVarNameParent = false;

    // SCSS tokens
    for (var varName in flattenedTokens) {
        let value = flattenedTokens[varName],
            varNameParent = varName.substr(0, varName.indexOf('-'));
        if (prevVarNameParent && prevVarNameParent !== varNameParent) {
            scss += '\n';
        }
        prevVarNameParent = varNameParent;

        scss += `$${tokenConfig.namespace}-${varName}: ${value} !default;\n`;
    }
    scss += scssMap + '\n';
    scss += `@function ${tokenConfig.namespace}-token($keys...) {\n` +
                `    $map: $${tokenConfig.namespace}-tokens;\n` +
                '    @each $key in $keys {\n' +
                '        $map: map-get($map, $key);\n' +
                '    }\n' +
                '    @return $map;\n' +
                '}\n';
    fs.writeFileSync(scssOutputFilepath, scss);
}

function convertTokensYaml(sourceFile) {
    if (tokensSourceFileExists(sourceFile)) {
        let tokens = tokensToJson(sourceFile);
        tokenConfig.formats.forEach(format => {
            switch (format) {
                case '.json':
                    tokens.namespace = c.codeNamespace;
                    writeTokensJsonFile(tokens, path.basename(sourceFile));
                    break;
                case '.scss':
                    tokens.namespace = '"' + c.codeNamespace + '"';
                    writeTokensScssFile(tokens, path.basename(sourceFile));
                    break;
            }
        });
    }
}

const buildAllTaskName = [c.tokensTaskName, c.buildTaskName, c.allTaskName].join(':');
gulp.task(config.getBaseTaskName(buildAllTaskName), function(done){
    gulp.src(tokenConfig.sourceFile)
        .pipe(tap(function(file, t){
            convertTokensYaml(file.path);
        }));
    done();
});
generateBasePreAndPostTasks(buildAllTaskName);

const watchAllTaskName = [c.watchTaskName, c.tokensTaskName, c.allTaskName].join(':');
gulp.task(config.getBaseTaskName(watchAllTaskName), function(){
    return gulp.watch([tokenConfig.sourceFile], gulp.series(buildAllTaskName));
});
generateBasePreAndPostTasks(watchAllTaskName);

module.exports = {
    convertTokensYaml: convertTokensYaml,
    tokensToJson: tokensToJson,
    interpolateYamlVariables: interpolateYamlVariables
};
