const chai = require('chai'),
      tmp = require('tmp'),
      path = require('path'),
      debug = require('debug')('overlay'),
      yamljs = require('yamljs'),
      _ = require('underscore'),
      async = require('async'),
      nodeDir = require('node-dir');

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

  function addDir(dir) {
    async.series([
      function (callback) {
        nodeDir.files(dir, function (err, files) {
          console.log(JSON.stringify(files, null, 2));
          callback(err);
        });
      }
    ], function (err) {
      return err;
    });
  };

  overlay.onto = function (onto, into) {
    onto = path.resolve(onto);
    expect(onto).to.be.a.directory().and.not.empty;
    this.map = {};

    addDir(this.config.from);
    addDir(onto);

    return overlay;
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
