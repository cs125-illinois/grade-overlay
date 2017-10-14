const chai = require('chai'),
      tmp = require('tmp'),
      path = require('path'),
      debug = require('debug')('overlay'),
      yamljs = require('yamljs'),
      _ = require('underscore'),
      async = require('async'),
      nodeDir = require('node-dir'),
      minimatch = require('minimatch');

chai.use(require('chai-fs'));
const expect = chai.expect;
tmp.setGracefulCleanup();

exports = module.exports = function (configFile) {
  configFile = path.resolve(configFile);
  expect(configFile).to.be.a.file().and.not.empty;
  let config = yamljs.load(configFile);

  config.from = path.resolve(path.join(path.dirname(configFile), config.from));
  expect(config.from).to.be.a.directory().and.not.empty;

  var overlay = {
    config: config
  };

  overlay.onto = function (onto, into) {
    onto = path.resolve(onto);
    expect(onto).to.be.a.directory().and.not.empty;

    let config = this.config;
    Promise.all([
      nodeDir.promiseFiles(config.from),
      nodeDir.promiseFiles(onto)
      ]).then((files) => {
        var [fromFiles, ontoFiles] = files;
        var map = {};
        _.each(config.steps, (step) => {
          var currentFiles;
          if (step.from) {
            currentFiles = fromFiles;
            currentRoot = config.from;
          } else if (step.onto) {
            currentFiles = ontoFiles;
            currentRoot = onto;
          }
          _.each((step.from || step.onto), (pattern) => {
            pattern = pattern.split(":");
            if (pattern.length == 1) {
              _.each(minimatch.match(currentFiles, pattern[0]), (file) => {
                let relativeFile = path.relative(currentRoot, file);
                if (!(map[relativeFile])) {
                  map[relativeFile] = file;
                }
              });
            }
          });
        });
        console.log(map);
      })
      .then(() => {
        return overlay;
      });
  };

  overlay.from = function (from) {
    if (from) {
      expect(from).to.be.a.directory().and.not.empty;
      this.config.from = from
    }

    return overlay;
  };

  overlay.into = function (into) {
    if (into) {
      expect(into).to.be.a.directory().and.empty;
      this.config.into = into
    }

    return overlay;
  };

  return overlay;
};
