const http = require('http'), fs = require('fs'), path = require('path'); const { makeRuntime } = require('./gas-mock');
const rt = makeRuntime({ props: { ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'Secret123', HOTEL_NAME: 'Demo Hotel' } });
rt.ctx.setupDatabase(); rt.ctx.addSampleRooms();
const web = path.join(__dirname, '..', 'web'); const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
http.createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*' };
  if (req.url.startsWith('/exec')) {
    if (req.method === 'POST') { let b = ''; req.on('data', d => b += d); req.on('end', () => { res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, cors)); res.end(JSON.stringify(rt.ctx.rpc(b))); }); return; }
    res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, cors)); return res.end('{"ok":true,"app":"SmartGuest"}');
  }
  if (req.url === '/__advance') { rt.advanceDays(1); res.writeHead(200, cors); return res.end('ok'); }
  let f = req.url.split('?')[0]; if (f === '/') f = '/index.html';
  const p = path.join(web, f); if (!p.startsWith(web) || !fs.existsSync(p)) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': mime[path.extname(p)] || 'text/plain' }); res.end(fs.readFileSync(p));
}).listen(8123, () => console.log('dev on 8123'));
