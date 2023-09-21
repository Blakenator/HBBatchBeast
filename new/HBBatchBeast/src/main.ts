import { app, BrowserWindow, ipcMain, Menu, Tray } from 'electron';
import { setupApiHandlers } from '@superflag/super-ipc/backend';
import path from 'path';
import { BackendAsyncHandlers, BackendHandlers } from './backend';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
    },
    title: 'HBBatchBeast',
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // Open the DevTools.
  mainWindow.webContents.openDevTools();
  let appIcon: Tray;
  let platform = 'win';
  let iconpath = path.join(__dirname, '.\\assets\\icons\\win\\icon.ico');
  let type = 'ico';

  if (process.platform == 'win32') {
    appIcon = new Tray(iconpath);

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show',
        click: () => {
          mainWindow.show();
        },
      },
      {
        label: 'Clear notification',
        click: () => {
          appIcon.setImage(iconpath);
        },
      },
      {
        label: 'Quit',
        click: () => {
          // app.isQuiting = true;
          app.quit();
        },
      },
    ]);

    appIcon.setContextMenu(contextMenu);

    mainWindow.on('close', (event) => {
      //  mainWindow = null
      // app.isQuiting = true;
      app.quit();
    });

    mainWindow.on('minimize', (event: Event) => {
      event.preventDefault();
      mainWindow.hide();
    });

    mainWindow.on('maximize', (event: Event) => {
      event.preventDefault();
      mainWindow.maximize();
    });

    mainWindow.on('unmaximize', (event: Event) => {
      event.preventDefault();
      mainWindow.unmaximize();
    });

    mainWindow.on('show', () => {
      // appIcon.setHighlightMode('always');
      //appIcon.setImage(iconpath);
    });

    //appIcon.setToolTip('Error!');
  }

  if (process.platform == 'win32') {
    platform = 'win';
    iconpath = path.join(__dirname, '.\\assets\\icons\\win\\icon.ico');
    type = 'ico';
    //var iconpath = "./assets/icons/win/icon.ico"
  }

  if (process.platform == 'linux') {
    platform = 'png';
    type = 'png';
    iconpath = './assets/icons/png/icon.png';
  }

  if (process.platform == 'darwin') {
    platform = 'mac';
    type = 'icns';
    iconpath = './assets/icons/mac/icon.icns';
  }

  //Catch icon updates
  ipcMain.on('item:add', (e, item) => {
    //  console.log(item);

    const icon = path.join(
      __dirname,
      '.\\assets\\icons\\' + platform + '\\' + item + '.ico',
    );

    //var icon ="./assets/icons/"+platform+"/"+item+"."+type;
    appIcon.setImage(icon);
  });

  ipcMain.on('item:ready', (e, item) => {
    mainWindow.webContents.send('item:ready', 'Test');
  });

  ipcMain.on('mediaview:ready', (e, item) => {
    mainWindow.webContents.send('mediaview:ready', 'Test');
  });

  ipcMain.on('benchstatus:ready', (e, item) => {
    mainWindow.webContents.send('benchstatus:ready', 'Test');
  });

  // ------------------- refactored ---------------------

  // setup handlers
  setupApiHandlers(app, BackendHandlers, BackendAsyncHandlers, ipcMain);

  // ----------------- end refactored -------------------
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow);

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
