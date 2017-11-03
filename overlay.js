#!/usr/bin/env node

'use strict'

const expect = require('chai').expect,
      tmp = require('tmp-promise'),
      path = require('path'),
      debug = require('debug')('overlay'),
      yamljs = require('yamljs'),
      _ = require('lodash'),
      multimatch = require('multimatch'),
      fs = require('fs-extra'),
      handlebars = require('handlebars'),
      globby = require('globby'),
      childProcess = require('child-process-promise');

tmp.setGracefulCleanup();

const globbyDefaults = {
  dot: true
};

let gradeOverlay = configFile => {
  let config = yamljs.load(path.resolve(configFile));
  if (config.overlay) {
    config = config.overlay;
  }

  config.globby = _.merge(config.globby || {}, globbyDefaults);
  config.globby.mark = true;
  config.exclude = _.merge({ both: [], from: [], onto: [] }, config.exclude);
  config.rename = { from: {}, onto: {} }

  config.root = path.resolve(path.join(path.dirname(configFile), config.root));
  config.from = _.map(config.from, from => {
    if (from.endsWith("/") && !from.startsWith("!")) {
      from += "**/*";
      config.exclude.onto.push("!" + from);
    } else if (from.indexOf(":") !== -1) {
      let to;
      [from, to] = from.split(":");
      config.rename.from[from] = to;
    }
    return from;
  });
  config.onto = _.map(config.onto, from => {
    if (from.indexOf(":") !== -1) {
      let to;
      [from, to] = from.split(":");
      config.rename.onto[from] = to;
    }
    return from;
  });
  config.template = config.template || [];

  config.loaded = false;
  config.map = {};

  let overlay = {
    load: () => {
      let patterns = _.union(config.from, config.exclude.from, config.exclude.both);
      return globby(patterns, _.merge({ cwd: config.root }, config.globby))
        .then(paths => {
          _.each(paths, p => {
            if (!p.endsWith("/")) {
              let dest = config.rename.from[p] || p;
              if (!(dest in config.map)) {
                config.map[dest] = path.join(config.root, p);
              }
            }
            config.loaded = true;
          });
        })
        .then(() => {
          return overlay;
        });
    },
    test: paths => {
      expect(config.loaded).to.be.true;
      let patterns = _.union(config.onto, config.exclude.onto, config.exclude.both);
      return _.filter(multimatch(paths, patterns), p => {
        return (!(p in config.map));
      });
    },
    overlay: (onto, context, into) => {
      context = context || {};
      expect(context).to.be.an('object');

      let patterns = _.union(config.onto, config.exclude.onto, config.exclude.both);
      let map = _.clone(config.map);
      let clobbered = {};
      return Promise.resolve()
        .then(() => {
          if (!config.loaded) {
            return overlay.load();
          }
        })
        .then(() => {
          return globby(patterns, _.merge({ cwd: onto }, config.globby));
        })
        .then(paths => {
          _.each(paths, p => {
            if (!p.endsWith("/")) {
              let dest = config.rename.onto[p] || p;
              if (!(dest in map)) {
                map[dest] = path.join(onto, p);
              } else {
                clobbered[dest] = {
                  from: map[dest],
                  onto: path.join(onto, p),
                  same: false
                };
              }
            }
          });
        })
        .then(() => {
          if (into) {
            return fs.mkdirs(into);
          } else {
            return tmp.dir({ keep: true, prefix: "overlay-" }).then(d => { into = d.path });
          }
        })
        .then(() => {
          return Promise.all(_.map(map, (from, to) => {
            let dest = path.join(into, to);
            let stats;
            return fs.stat(from)
              .then(s => {
                stats = s;
                return fs.mkdirs(path.dirname(dest));
              })
              .then(() => {
                return fs.copy(from, dest);
              })
              .then(() => {
                if (config.template.indexOf(to) === -1) {
                  return;
                }
                return fs.readFile(dest)
                  .then((data) => {
                    let contents = handlebars.compile(data.toString())(context);
                    return fs.writeFile(dest, contents);
                  });
              })
              .then(() => {
                return fs.chown(dest, stats.uid, stats.gid);
              })
              .then(() => {
                return fs.chmod(dest, stats.mode);
              })
              .then(() => {
                return fs.utimes(dest, stats.atime, stats.mtime);
              });
          }));
        })
        .then(() => {
          return Promise.all(_.map(clobbered, (info, dest) => {
            return childProcess.exec(`diff ${info.from} ${info.onto}`, {
                stdio: ['ignore', 'ignore', 'ignore']
              })
              .then(() => {
                info.same = true;
              })
              .catch(() => { });
          }));
        })
        .then(() => {
          return {
            into: into,
            clobbered: (_(clobbered).pickBy(info => {
              return !info.same
            }).each(info => {
              delete info.same
            }))
          };
        })
        .catch(err => {
          throw err;
        });
    },
  }
  return overlay;
}
exports = module.exports = gradeOverlay

if (require.main !== module) {
  return;
}

try {
  let argv = require('minimist')(process.argv.slice(2));

  let configFile = path.resolve(argv._[0]);
  let onto = path.resolve(argv._[1]);
  let context = argv.context ? yamljs.load(argv.context) : undefined;

  let myOverlay = gradeOverlay(configFile);
  myOverlay.load().then(() => {
    return myOverlay.overlay(onto, context, argv.into);
  }).then(result => {
    console.log(JSON.stringify(result, null, 2));
  }).catch(err => {
    throw err;
  });
} catch (err) {
  console.log(err);
  console.log(`
usage: overlay configuration.yaml onto [--into=into] [--context=context]
       configuration.yaml: overlay configuration file
       onto: the directory to overlay onto
       into: override where to put the results (default: temporary directory)
       context: context to use for templated files, if any`);
}
