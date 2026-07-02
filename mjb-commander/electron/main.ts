import { app, BrowserWindow, Menu, shell, dialog, ipcMain } from "electron";
import * as path from "path";

let mainWindow: BrowserWindow | null = null;

const isDev = !app.isPackaged;

function createMainWindow(): void {

    mainWindow = new BrowserWindow({

        width: 1700,

        height: 980,

        minWidth: 1400,

        minHeight: 850,

        backgroundColor: "#0B1220",

        title: "MJB Commander",

        autoHideMenuBar: true,

        show: false,

        webPreferences: {

            preload: path.join(__dirname, "preload.js"),

            contextIsolation: true,

            nodeIntegration: false,

            sandbox: false

        }

    });

    if (isDev) {

        mainWindow.loadURL("http://localhost:5173");

        mainWindow.webContents.openDevTools();

    } else {

        mainWindow.loadFile(
            path.join(__dirname, "../dist/index.html")
        );

    }

    mainWindow.once("ready-to-show", () => {

        mainWindow?.show();

    });

    mainWindow.on("closed", () => {

        mainWindow = null;

    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {

        shell.openExternal(url);

        return { action: "deny" };

    });

}

function createApplicationMenu() {

    const template: Electron.MenuItemConstructorOptions[] = [

        {
            label: "File",
            submenu: [

                {
                    label: "New Project",

                    accelerator: "Ctrl+N",

                    click() {

                        mainWindow?.webContents.send("new-project");

                    }

                },

                {
                    label: "Open Project",

                    accelerator: "Ctrl+O",

                    click() {

                        mainWindow?.webContents.send("open-project");

                    }

                },

                { type: "separator" },

                {

                    role: "quit"

                }

            ]

        },

        {
            label: "Knowledge",

            submenu: [

                {

                    label: "Import Reference",

                    click() {

                        mainWindow?.webContents.send("import-reference");

                    }

                },

                {

                    label: "Rebuild Index",

                    click() {

                        mainWindow?.webContents.send("rebuild-index");

                    }

                }

            ]

        },

        {
            label: "Operations",

            submenu: [

                {

                    label: "Operational Approach"

                },

                {

                    label: "PMESII"

                },

                {

                    label: "Center Of Gravity"

                }

            ]

        },

        {

            label: "Help",

            submenu: [

                {

                    label: "About",

                    click() {

                        dialog.showMessageBox({

                            title: "MJB Commander",

                            message:

                                "Military AI Knowledge Platform\nVersion 1.0 Alpha"

                        });

                    }

                }

            ]

        }

    ];

    Menu.setApplicationMenu(

        Menu.buildFromTemplate(template)

    );

}

app.whenReady().then(() => {

    createApplicationMenu();

    createMainWindow();

    app.on("activate", () => {

        if (BrowserWindow.getAllWindows().length === 0) {

            createMainWindow();

        }

    });

});

app.on("window-all-closed", () => {

    if (process.platform !== "darwin") {

        app.quit();

    }

});

ipcMain.handle("application-version", () => {

    return app.getVersion();

});
