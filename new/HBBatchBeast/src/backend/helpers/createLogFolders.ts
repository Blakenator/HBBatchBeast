import fs from 'fs';

export function createLogFolders(homePath: string) {
  //create folders/logs if not exist
  if (!fs.existsSync(homePath + '/Documents/HBBatchBeast')) {
    fs.mkdirSync(homePath + '/Documents/HBBatchBeast', { recursive: true });

  }

  if (!fs.existsSync(homePath + '/Documents/HBBatchBeast/Config')) {
    fs.mkdirSync(homePath + '/Documents/HBBatchBeast/Config', { recursive: true });

  }

  if (!fs.existsSync(homePath + '/Documents/HBBatchBeast/Config/Processes')) {
    fs.mkdirSync(homePath + '/Documents/HBBatchBeast/Config/Processes', { recursive: true });
  }

  if (!fs.existsSync(homePath + '/Documents/HBBatchBeast/Config/Processes/WorkerStatus')) {
    fs.mkdirSync(homePath + '/Documents/HBBatchBeast/Config/Processes/WorkerStatus', { recursive: true });
  }

  if (!fs.existsSync(homePath + '/Documents/HBBatchBeast/Config/Processes/WorkerStatus/Console')) {
    fs.mkdirSync(homePath + '/Documents/HBBatchBeast/Config/Processes/WorkerStatus/Console', { recursive: true });
  }

  if (!fs.existsSync(homePath + '/Documents/HBBatchBeast/Config/Processes/WorkerStatus/ErrorLogs')) {
    fs.mkdirSync(homePath + '/Documents/HBBatchBeast/Config/Processes/WorkerStatus/ErrorLogs', { recursive: true });
  }

  if (!fs.existsSync(homePath + '/Documents/HBBatchBeast/Logs')) {
    fs.mkdirSync(homePath + '/Documents/HBBatchBeast/Logs', { recursive: true });
  }

  if (!fs.existsSync(homePath + '/Documents/HBBatchBeast/Logs/MasterLog.txt')) {
    fs.appendFileSync(homePath + '/Documents/HBBatchBeast/Logs/MasterLog.txt', '', 'utf8');
  }

  if (!fs.existsSync(homePath + '/Documents/HBBatchBeast/Logs/healthyFileList.txt')) {
    fs.appendFileSync(homePath + '/Documents/HBBatchBeast/Logs/healthyFileList.txt', '', 'utf8');
  }

  if (!fs.existsSync(homePath + '/Documents/HBBatchBeast/Logs/originalFileReplacedList.txt')) {
    fs.appendFileSync(homePath + '/Documents/HBBatchBeast/Logs/originalFileReplacedList.txt', '', 'utf8');
  }

  if (!fs.existsSync(homePath + '/Documents/HBBatchBeast/Logs/ErrorLog.txt')) {
    fs.appendFileSync(homePath + '/Documents/HBBatchBeast/Logs/ErrorLog.txt', '', 'utf8');
  }

  if (!fs.existsSync(homePath + '/Documents/HBBatchBeast/Logs/fileConversionLog.txt')) {
    fs.appendFileSync(homePath + '/Documents/HBBatchBeast/Logs/fileConversionLog.txt', '', 'utf8');
  }

  if (!fs.existsSync(homePath + '/Documents/HBBatchBeast/Logs/Scans.txt')) {
    fs.appendFileSync(homePath + '/Documents/HBBatchBeast/Logs/Scans.txt', '', 'utf8');
  }
}
