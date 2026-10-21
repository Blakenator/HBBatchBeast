
function updateConsole(text) {
    var message = [
        "consoleMessage",
        text,
    ];
    process.send(message);


}


process.on('uncaughtException', function (err) {
    //console.error(err.stack);
    updateConsole("Shell thread module: " + err.stack)
    process.exit();
});


//global variables
var shellWorker
var shell = require('shelljs');
var fs = require('fs');
var home = require("os").homedir();


function stopShellWorker() {
    if (!shellWorker || !shellWorker.pid) return;

    try {
        if (process.platform == 'win32') {
            shell.exec('taskkill /PID ' + shellWorker.pid + ' /T /F');
        } else {
            shell.exec('pkill -P ' + shellWorker.pid);
            process.kill(shellWorker.pid, 'SIGTERM');
        }
    } catch (err) { }
}

// Make sure a signal, parent crash or closed terminal also stops the encoder.
for (const shutdownSignal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(shutdownSignal, function () {
        stopShellWorker();
        process.exit(0);
    });
}

process.on('disconnect', function () {
    stopShellWorker();
    process.exit(0);
});



//console.log(randomvariable)

process.on('message', (infoArray) => {

    console.log("shellThread")

    if (infoArray[0] == "processFile") {

        var workerCommand = infoArray[1];

        shellWorker = shell.exec(workerCommand, function (code, stdout, stderr, stdin) {
            //console.log('Exit code:', code);

            var message = [
                "Exit",
                code,
            ];
            process.send(message);


            //console.log('Program output:', stdout+"    PID:"+shellWorker.pid);
            //console.log('stderr:', stderr);
            //fs.appendFileSync(homePath+"/HBBatchBeast/Config/Processes/WorkerStatus/Console/ShellLog.txt", "exit", 'utf8');

            process.exit()
        });
    }


    if (infoArray[0] == "exitThread") {

        if (infoArray[1] == "itemCancelled") {

            var message = [
                "Exit",
                "Cancelled",
            ];
            process.send(message);

        }

        stopShellWorker();

        process.exit();
    }
});





