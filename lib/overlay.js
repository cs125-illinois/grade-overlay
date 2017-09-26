const debug = require('debug')('overlay'),
      chai = require('chai'),
      _ = require('underscore'),
      cwd = require('cwd'),
      tmp = require('tmp'),
      fs = require('fs-extra'),
      path = require('path'),
      yamljs = require('yamljs');

chai.use(require('chai-fs'));
const expect = chai.expect;

var setConfig = function(argv) {

  tmp.setGracefulCleanup();
  var config = {
    onto: argv._[0],
    from: argv.from,
    into: argv.into,
    working: tmp.dirSync({ unsafeCleanup: true }).name
  }

  expect(config.onto).to.be.a.directory().and.not.empty;
  config.onto = path.resolve(config.onto);

  if (!config.from) {
    config.from = cwd();
  }
  expect(config.from).to.be.a.directory().and.not.empty;
  config.from = path.resolve(config.from);

  if (!config.into) {
    config.into = path.join(config.working, "into");
    fs.mkdir(config.into);
  }
  expect(config.into).to.be.a.directory().and.empty;
  config.into = path.resolve(config.into);

  expect(_.uniq([config.onto, config.from, config.into])).to.have.lengthOf(3, "onto, from, and into config should all be unique");

  var configurationPath = path.join(config.from, ".overlay.yaml");
  expect(configurationPath).to.be.a.file().and.not.empty;
  config.overlay = yamljs.load(configurationPath);

  return config;
}

exports.setConfig = setConfig
