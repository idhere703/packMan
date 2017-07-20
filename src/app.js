import fetch from 'node-fetch';
import semver from 'semver';
import fs from 'fs-extra';
import { linkPackages, optimizePackageTree } from './packages';
import getPackageDependencyTree from './dependencies'
import { trackProgress } from './utils';
import { resolve } from 'path';

// Package run code goes here.


// We'll use the first command line argument (argv[2]) as working directory,
// but if there's none we'll just use the directory from which we've executed
// the script
let cwd = resolve(process.argv[2] || process.cwd());
let packageJson = require(resolve(cwd, `package.json`));
console.log(packageJson);

// And as destination, we'll use the second command line argument (argv[3]),
// or the cwd if there's none. We do this because for such a minipkg, it would
// be nice not to override the 'true' node_modules :)
let dest = resolve(process.argv[3] || cwd);

// Remember that because we use a different format for our dependencies than
// a simple dictionary, we also need to convert it when reading this file
packageJson.dependencies = Object.keys(packageJson.dependencies || {}).map(name => {
    return {
        name,
        reference: packageJson.dependencies[name]
    };
});

Promise.resolve().then(() => {
    console.log(`Resolving the package tree...`);
    return trackProgress(pace => getPackageDependencyTree(pace, packageJson));
}).then(packageTree => {
    console.log(`Linking the packages on the filesystem...`);
    return trackProgress(pace => linkPackages(pace, optimizePackageTree(packageTree), dest));
}).catch(error => {
    console.log(error.stack);
    process.exit(1);
});