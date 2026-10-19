const net = require('net');
const {spawn} = require('child_process');

const DEV_SERVER_BASE_PORT = 3003;
const NETLIFY_BASE_PORT = 9999;

function canListen(port, host) {
	return new Promise(resolve => {
		const server = net.createServer();
		server.once('error', error => resolve(error.code === 'EAFNOSUPPORT' || error.code === 'EADDRNOTAVAIL'));
		server.listen(port, host, () => server.close(() => resolve(true)));
	});
}

async function freePort(from) {
	for (let port = from; port <= 65535; port++) {
		if ((await canListen(port, '0.0.0.0')) && (await canListen(port, '::'))) {
			return port;
		}
	}
	throw new Error(`No free port from ${from}`);
}

(async () => {
	const targetPort = await freePort(DEV_SERVER_BASE_PORT);
	const port = await freePort(NETLIFY_BASE_PORT);
	if (targetPort !== DEV_SERVER_BASE_PORT || port !== NETLIFY_BASE_PORT) {
		console.log(`Default ports are busy, using ${targetPort} for the dev server. Open http://localhost:${port}`);
	}

	const command = ['netlify', 'dev', '--target-port', targetPort, '--port', port, ...process.argv.slice(2)].join(' ');
	const child = spawn(command, {stdio: 'inherit', shell: true, env: {...process.env, DEV_SERVER_PORT: String(targetPort)}});
	// Ctrl+C also reaches netlify, wait for it to shut down.
	process.on('SIGINT', () => {});
	child.on('exit', code => process.exit(code === null ? 1 : code));
})();
