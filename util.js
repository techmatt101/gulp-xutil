var fs = require('fs');
var chalk = require('chalk');
var gulp = require('gulp');
var util = require('gulp-util');

util.isProduction = util.env.production || util.env.live || util.env.release;
util.isDev = !util.isProduction;
util.isWatching = process.argv.join('').indexOf('watch') !== -1;
util.isSmart = util.env.smart;
util.isParallel = util.env.ll !== false;
util.isWorker = util.env['ll-worker'];
util.isSpeedy = util.env.speed || util.env.speedy || util.env.quick || util.env.fast;
util.ignoreErrors = util.env.ignore || util.isWatching || util.isSpeedy;

var currentTask = '';
var failedTasks = {};

const ENV = util.isDev ? 'DEV' : 'PRODUCTION';

util.getState = function() {
    var tasksFailed = [];
    for(var task in failedTasks) {
        if(failedTasks[task]) {
            tasksFailed.push(task);
        }
    }
    return {
        env: ENV,
        failedTasks: tasksFailed
    };
};

util.logEnv = function() {
    var project = require('../../package.json');

    var msg = [
        chalk.bold(project.name),
        chalk.inverse(ENV) 
    ];

    if(util.isWatching) {
        msg.push(chalk.bgMagenta('WATCHING'));
    }
    if(util.isParallel) {
        msg.push(chalk.bgBlue('PARALLEL BUILD'));
    }
    if(util.isSmart) {
        msg.push(chalk.bgBlue('SMART BUILD'));
    }
    if(util.isSpeedy) {
        msg.push(chalk.bgRed('SPEEDY BUILD'));
    }
    if(util.ignoreErrors) {
        msg.push(chalk.bgRed('IGNORE ERRORS'));
    }
    
    util.log(msg.join(' | '));
};

util.saveBuildState = function() {
    fs.writeFileSync('.gulp-state', JSON.stringify(util.getState()));
};

util.hasStateChanged = function() {
    var currentState = util.getState();
    var prevState = null;

    try {
        prevState = JSON.parse(fs.readFileSync('.gulp-state', 'utf8'));
    } catch(e) {
        return true;
    }

    return prevState.env !== currentState.env || prevState.failedTasks.length > 0;
};

util.enableSmartBuild = function() {
    if(!util.hasStateChanged()) {
        util.isSmart = true;
        process.argv.push('--smart'); // pass to workers
    } else if(util.env.smart) {
        var i = process.argv.indexOf('--smart');
        process.argv.splice(i, 1);
    }
};

util.disableParallel = function(){
    process.argv.push('--no-ll');
    util.isParallel = false;
};

util.handleError = (err, taskName) => {
    failedTasks[taskName || currentTask] = true;
    if(!util.ignoreErrors) {
        process.exit(1);
    }
};

util.loadPlugins = function(disabledPlugins) {
    var pluginLoader = require('gulp-load-plugins');
    var through2 = require('through2');

    var plugins = pluginLoader({
        //lazy: false,
        //debug: true,
        renameFn: (name) => {
            name = name.replace('gulp-', '').replace(/-(\w)/g, (m, p1) => p1.toUpperCase());
            if(disabledPlugins.indexOf(name) !== -1) {
                return name + '_disabled';
            }
            return name;
        }
    });

    disabledPlugins.forEach((name) => {
        var lookup = plugins;
        var keys = name.split('.');
        var key = keys[keys.length - 1];
        for(var i = 0; i < keys.length - 1; i++) {
            lookup = lookup[keys[i]] = lookup[keys[i]] || {};
        }
        lookup[key] = () => through2.obj();
    });

    return plugins;
};

util.trackBuildFails = function() {
    gulp.Gulp.prototype.__runTask = gulp.Gulp.prototype._runTask;
    gulp.Gulp.prototype._runTask = function(task) {
        currentTask = task.name;
        failedTasks[currentTask] = false;
        if(task.fn) {
            var oldFn = task.fn;
            task.fn = function() {
                var result = oldFn.apply(this, arguments);
                if(result && result.catch) {
                    result.catch((err) => { //catch parallel tasks
                        util.handleError(err, task.name);
                    });
                }
                return result;
            };
        }
        this.__runTask(task);
    };
    if(util.isWorker) { // stop workers from swallowing errors
        process.on('exit', () => {
            if(util.getState().failedTasks.length > 0) {
                process.exit(1);
            }
        });
    }
};

util.catchProcessErrors = function() {
    process.on('SIGINT', () => { //catches ctrl+c event
        process.exit();
    });
    process.on('uncaughtException', util.handleError);
    process.on('exit',  util.saveBuildState);
};

module.exports = util;