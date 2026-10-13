// AOS DCalculator masaüstü kabuğu: derlenmiş uygulamayı (dist/) app:// protokolüyle sunar.
// file:// yerine özel protokol kullanılır: fetch/Worker/IndexedDB kararlı bir kökenle (app://dcalculator) çalışır,
// proje verisi (IndexedDB) sürümler arasında korunur.
const { app, BrowserWindow, protocol, net, shell, Menu } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const HOST = 'dcalculator'
const DIST = path.join(__dirname, '..', 'dist')

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
])

if (!app.requestSingleInstanceLock()) app.quit()

let win = null

function serve() {
  protocol.handle('app', (req) => {
    const u = new URL(req.url)
    if (u.host !== HOST) return new Response('Not found', { status: 404 })
    let rel = decodeURIComponent(u.pathname)
    if (rel === '/' || rel === '') rel = '/index.html'
    const file = path.normalize(path.join(DIST, rel))
    // dist dışına çıkışı engelle
    if (file !== DIST && !file.startsWith(DIST + path.sep)) return new Response('Forbidden', { status: 403 })
    return net.fetch(pathToFileURL(file).toString())
  })
}

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    backgroundColor: '#0f172a',
    title: 'AOS DCalculator',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  if (process.platform !== 'darwin') win.removeMenu()
  win.once('ready-to-show', () => {
    win.maximize()
    win.show()
  })
  // Dış bağlantılar sistem tarayıcısında açılır; uygulama penceresi başka adrese gitmez.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`app://${HOST}/`)) {
      e.preventDefault()
      if (/^https?:/.test(url)) void shell.openExternal(url)
    }
  })
  void win.loadURL(`app://${HOST}/index.html`)
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.whenReady().then(() => {
  if (process.platform === 'darwin') Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]))
  serve()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
