const chai = require('chai'),
      tmp = require('tmp'),
      path = require('path'),
      debug = require('debug')('overlay'),
      yamljs = require('yamljs'),
      _ = require('underscore'),
      async = require('async'),
      nodeDir = require('node-dir'),
      minimatch = require('minimatch'),
      multimatch = require('multimatch');

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
    let minimatchOptions = _.extend(config.minimatch || {}, {
      dot: true
    });

    var copyMap = {};
    var toTemplate = [];
    return Promise.all([
      nodeDir.promiseFiles(config.from),
      nodeDir.promiseFiles(onto)
      ]).then((files) => {
        let fromFiles = _.map(files[0], (file) => {
          return path.relative(config.from, file);
        });
        let ontoFiles = _.map(files[1], (file) => {
          return path.relative(onto, file);
        });
        fromFiles = _.difference(fromFiles, multimatch(fromFiles, config.ignore));
        ontoFiles = _.difference(ontoFiles, multimatch(ontoFiles, config.ignore));

        _.each(config.steps, (step) => {
          var currentFiles;

          if (step.copy || step.ignore) {
            expect(step.source).to.be.oneOf(['from', 'onto']);
            if (step.source === 'from') {
              currentFiles = fromFiles;
              currentRoot = config.from;
            } else if (step.source === 'onto') {
              currentFiles = ontoFiles;
              currentRoot = onto;
            }

            _.each((step.copy || step.ignore), (pattern) => {
              pattern = pattern.split(":");
              expect(pattern.length).to.be.oneOf([1, 2]);
              if (pattern.length == 1) {
                _.each(minimatch.match(currentFiles, pattern[0], minimatchOptions), (file) => {
                  if (!(file in copyMap)) {
                    if (step.copy || step.template) {
                      copyMap[file] = path.join(currentRoot, file);
                    } else if (step.ignore) {
                      copyMap[file] = false;
                    }
                  }
                });
              } else if (pattern.length == 2) {
                expect(step.ignore).to.be.undefined;
                let file = minimatch.match(currentFiles, pattern[0], minimatchOptions);
                expect(file).to.have.lengthOf(1);
                file = file[0];
                copyMap[pattern[1]] = path.join(currentRoot, file);
              }
            });
          } else if (step.template) {
            expect(step.source).to.be.undefined;
            expect(config.context).to.not.be.undefined;
            _.each(step.template, (file) => {
              expect(copyMap[file]).to.not.be.undefined;
              toTemplate.push(file);
            });
          }
        });
        copyMap = _.pick(copyMap, (to) => {
          return to !== false;
        });
        toTemplate = _.uniq(toTemplate);
      })
      .then(() => {
        config.into = config.into || tmp.dirSync({ keep: true }).name;
        expect(config.into).to.be.a.directory().and.empty;
        _.each(copyMap, (from, to) => {
          //
        });
      })
      .then(() => {
        return overlay.config.into;
      })
      .catch((err) => {
        throw err;
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

  overlay.context = function (context) {
    if (context) {
      expect(context).to.be.an('object');
      this.config.context = context;
    }
    return overlay;
  };

  return overlay;
};
