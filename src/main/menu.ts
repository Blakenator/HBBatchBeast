import { app, Menu, MenuItemConstructorOptions, shell } from 'electron';

/** Application menu: quit, reload, zoom, devtools and a way to file a bug. */
export function installAppMenu(): void {
  const isMac = process.platform === 'darwin';

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            role: 'appMenu',
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ] as MenuItemConstructorOptions[])
      : []),
    {
      label: 'File',
      submenu: [isMac ? { role: 'close' } : { role: 'quit' }],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        ...(app.isPackaged
          ? []
          : ([{ role: 'toggleDevTools' }] as MenuItemConstructorOptions[])),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, ...(isMac ? [] : [{ role: 'close' as const }])],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Report an issue',
          click: () => {
            void shell.openExternal(
              'https://github.com/Blakenator/HBBatchBeast/issues',
            );
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
