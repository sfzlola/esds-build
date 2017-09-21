'use strict';
const fs = require('fs'),
        path = require('path'),
        jsBeautify = require('js-beautify').js_beautify,
        appRoot = require('app-root-path'),
        esdsPackageJson = require('../package.json'),
        gulpfilePath = path.join(appRoot.toString(), 'gulpfile.js'),
        appPackageJsonPath = path.join(appRoot.toString(), 'package.json');


// Create gulpfile.js in the app repo consuming esds-build
if (!fs.existsSync(gulpfilePath)) {
    fs.writeFileSync(gulpfilePath, `const gulp = require('${esdsPackageJson.name}');`);
}

// Modify package.json in the app repo consuming esds-build to add a prepack hook to build autogenerated files
if (fs.existsSync(appPackageJsonPath)) {
    let appPackageJson = require(appPackageJsonPath);
    if (appPackageJson.scripts && typeof appPackageJson.scripts.prepack === 'undefined') {
        appPackageJson.scripts.prepack = 'gulp build:all';
        fs.writeFileSync(appPackageJsonPath, jsBeautify(JSON.stringify(appPackageJson), { indent_size: 2 }));
    }
}
