#!/usr/bin/env node

const expect = require('chai').expect,
      tmp = require('tmp-promise'),
      path = require('path'),
      debug = require('debug')('overlay'),
      yamljs = require('yamljs'),
      _ = require('lodash'),
      multimatch = require('multimatch'),
      fs = require('fs-extra'),
      handlebars = require('handlebars'),
      globby = require('globby');

'use strict'

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
    onto: onto => {
      let patterns = _.union(config.onto, config.exclude.onto, config.exclude.both);
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
              if (!(dest in config.map)) {
                config.map[dest] = path.join(onto, p);
              }
            }
          });
        })
        .then(() => {
          if (config.into) {
            return fs.mkdirs(config.into);
          } else {
            return tmp.dir({ keep: true }).then(d => { config.into = d.path });
          }
        })
        .then(() => {
          return Promise.all(_.map(config.map, (from, to) => {
            let dest = path.join(config.into, to);
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
                    let contents = handlebars.compile(data.toString())(config.context);
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
          return config.into;
        })
        .catch((err) => {
          throw err;
        });
    },
    into: into => {
      if (into) {
        config.into = into
      }
      return overlay;
    },
    context: context => {
      if (context) {
        expect(context).to.be.an('object');
        config.context = context;
      }
      return overlay;
    }
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

  let myOverlay = gradeOverlay(configFile).into(argv.into).context(context);
  myOverlay.load().then(() => {
    return myOverlay.onto(onto);
  }).then((into) => {
    console.log(into);
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
