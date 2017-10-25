const chai = require('chai'),
      tmp = require('tmp'),
      path = require('path'),
      debug = require('debug')('overlay'),
      yamljs = require('yamljs'),
      _ = require('underscore'),
      async = require('async'),
      nodeDir = require('node-dir'),
      minimatch = require('minimatch'),
      multimatch = require('multimatch'),
      fs = require('fs-extra'),
      handlebars = require('handlebars');

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
    var rmMap = {
      onto: {},
      from: {}
    };
    var toTemplate = [];
    var statMap = {};

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
        fromFiles = _.difference(fromFiles, multimatch(fromFiles, config.rm));
        ontoFiles = _.difference(ontoFiles, multimatch(ontoFiles, config.rm));

        _.each(config.steps, (step) => {
          var currentFiles;

          if (step.cp || step.rm) {
            expect(step.source).to.be.oneOf(['from', 'onto']);
            if (step.source === 'from') {
              currentFiles = fromFiles;
              currentRoot = config.from;
            } else if (step.source === 'onto') {
              currentFiles = ontoFiles;
              currentRoot = onto;
            }

            _.each((step.cp || step.rm), (pattern) => {
              pattern = pattern.split(":");
              expect(pattern.length).to.be.oneOf([1, 2]);
              if (pattern.length == 1) {
                _.each(minimatch.match(currentFiles, pattern[0], minimatchOptions), (file) => {
                  if (!(file in rmMap[step.source])) {
                    if (step.cp || step.template) {
                      copyFile = path.join(currentRoot, file);
                      expect(copyFile).to.be.a.file();
                      copyMap[file] = copyFile;
                    } else {
                      rmMap[step.source][file] = true;
                    }
                  }
                });
              } else if (pattern.length == 2) {
                expect(step.rm).to.be.undefined;
                let file = minimatch.match(currentFiles, pattern[0], minimatchOptions);
                expect(file).to.have.lengthOf(1);
                file = file[0];
                let copyFile = path.join(currentRoot, file);
                expect(copyFile).to.be.a.file();
                copyMap[pattern[1]] = copyFile;
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
        return Promise.all(_.map(copyMap, (from, to) => {
          let destination = path.join(config.into, to);
          let stats;
          return fs.lstat(from)
            .then((s) => {
              stats = s;
              return fs.mkdirs(path.dirname(destination));
            })
            .then(() => {
              return fs.copy(from, destination);
            })
            .then(() => {
              if (toTemplate.indexOf(to) === -1) {
                return;
              }
              return fs.readFile(destination)
                .then((data) => {
                  let contents = handlebars.compile(data.toString())(config.context);
                  return fs.writeFile(destination, contents);
                });
            })
            .then(() => {
              return fs.chown(destination, stats.uid, stats.gid);
            })
            .then(() => {
              return fs.chmod(destination, stats.mode);
            })
            .then(() => {
              return fs.utimes(destination, stats.atime, stats.mtime);
            });
        }));
      })
      .then(() => {
        return config.into;
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
