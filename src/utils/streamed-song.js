// decodeAudioData only takes whole files, but an Ogg prefix cut at a page start decodes to the same
// samples as the whole song, except the last few thousand, which depend on the data after the cut.

const PROCESSOR = `
class StreamedSongProcessor extends AudioWorkletProcessor {
	static get parameterDescriptors() {
		return [{name: 'playbackRate', defaultValue: 1, automationRate: 'k-rate'}];
	}

	constructor() {
		super();
		this.chunks = [];
		this.length = 0;
		this.complete = false;
		this.voice = null;
		this.port.onmessage = ({data}) => this.receive(data);
	}

	receive({chunk, complete, start, stop, read, release}) {
		if (this.released) return;
		if (read) {
			const samples = new Float32Array(read.length);
			const filled = this.copyMono(read.from, samples);
			this.port.postMessage({read: read.id, samples: filled ? samples : null}, filled ? [samples.buffer] : []);
			return;
		}
		if (release) {
			// The node can outlive its song (worklet nodes aren't reliably collected), so the samples go now.
			this.released = true;
			this.chunks = [];
			this.voice = null;
			this.port.onmessage = null;
			this.port.close();
			return;
		}
		if (chunk) {
			this.chunks.push({start: this.length, channels: chunk});
			this.length += chunk[0].length;
		}
		if (complete) {
			this.complete = true;
		}
		if (chunk || complete) {
			this.port.postMessage({loaded: this.length, complete: this.complete});
		}
		if (start) {
			this.voice = {id: start.id, from: Math.round(start.when * sampleRate), until: Infinity, position: start.offset * sampleRate, chunk: 0, stalled: false};
		}
		if (stop && this.voice && this.voice.id === stop.id) {
			this.voice.until = Math.round(stop.when * sampleRate);
		}
	}

	copyMono(from, out) {
		if (from < 0 || from + out.length > this.length) return false;
		let written = 0;
		for (const chunk of this.chunks) {
			const length = chunk.channels[0].length;
			if (chunk.start + length <= from + written) continue;
			const left = chunk.channels[0];
			const right = chunk.channels[1] || left;
			for (let i = from + written - chunk.start; i < length && written < out.length; i++, written++) {
				out[written] = (left[i] + right[i]) / 2;
			}
			if (written === out.length) break;
		}
		return written === out.length;
	}

	chunkAt(voice, index) {
		let c = voice.chunk < this.chunks.length && this.chunks[voice.chunk].start <= index ? voice.chunk : 0;
		while (c + 1 < this.chunks.length && this.chunks[c + 1].start <= index) c++;
		voice.chunk = c;
		return this.chunks[c];
	}

	process(inputs, outputs, parameters) {
		if (this.released) return false;
		const output = outputs[0];
		output.forEach(channel => channel.fill(0));
		const voice = this.voice;
		if (!voice || voice.done) return true;

		const rate = parameters.playbackRate[0];
		for (let i = 0; i < output[0].length; i++) {
			const frame = currentFrame + i;
			if (frame < voice.from || frame >= voice.until) continue;

			const index = Math.floor(voice.position);
			if (index + 1 >= this.length && !(this.complete && index < this.length)) {
				if (this.complete) {
					voice.done = true;
				} else if (!voice.stalled) {
					voice.stalled = true;
					this.port.postMessage({stalled: voice.id, position: voice.position / sampleRate});
				}
				continue;
			}
			if (voice.stalled) {
				voice.stalled = false;
				this.port.postMessage({playing: voice.id, position: voice.position / sampleRate, time: frame / sampleRate});
			}

			const chunk = this.chunkAt(voice, index);
			const offset = index - chunk.start;
			const next = offset + 1 < chunk.channels[0].length ? chunk : this.chunks[voice.chunk + 1];
			const nextOffset = next === chunk ? offset + 1 : 0;
			const t = voice.position - index;
			for (let c = 0; c < output.length; c++) {
				const value = chunk.channels[Math.min(c, chunk.channels.length - 1)][offset];
				const following = t > 0 && next ? next.channels[Math.min(c, next.channels.length - 1)][nextOffset] : value;
				output[c][i] = value + (following - value) * t;
			}
			voice.position += rate;
		}
		return true;
	}
}
registerProcessor('streamed-song', StreamedSongProcessor);
`;

const FIRST_DECODE = 128 * 1024;
const STALL_DECODE = 64 * 1024;
const SAFE_TAIL = 8192;

const processors = new WeakMap();

function loadProcessor(context) {
	if (!processors.has(context)) {
		const url = URL.createObjectURL(new Blob([PROCESSOR], {type: 'application/javascript'}));
		processors.set(context, context.audioWorklet.addModule(url));
	}
	return processors.get(context);
}

function supportsStreamedSong(context) {
	return !!(context.audioWorklet && window.AudioWorkletNode && window.ReadableStream);
}

function isOggPage(bytes, i) {
	return bytes[i] === 0x4f && bytes[i + 1] === 0x67 && bytes[i + 2] === 0x67 && bytes[i + 3] === 0x53;
}

function lastOggPage(bytes, length) {
	for (let i = length - 4; i > 0; i--) {
		if (isOggPage(bytes, i)) {
			return i;
		}
	}
	return 0;
}

function boxType(bytes, i) {
	return String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]);
}

// The moov box, ahead of the audio data in a faststart MP4, has arrived whole.
function mp4IndexArrived(bytes, length) {
	let moov = false;
	for (let i = 0; i + 8 <= length; ) {
		const type = boxType(bytes, i);
		if (type === 'mdat') {
			return moov;
		}
		moov = moov || type === 'moov';
		const size = ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
		if (size < 8) {
			return false;
		}
		i += size;
	}
	return false;
}

function decodableLength(bytes, length) {
	if (isOggPage(bytes, 0)) {
		return lastOggPage(bytes, length);
	}
	return boxType(bytes, 0) === 'ftyp' && mp4IndexArrived(bytes, length) ? length : 0;
}

class StreamedSong {
	constructor(context, src, mediaDuration) {
		this.context = context;
		this.src = src;
		this.mediaDuration = mediaDuration || 0;
		this.loadedFrames = 0;
		this.sentFrames = 0;
		this.decodedBytes = 0;
		this.complete = false;
		this.voices = 0;
		this.voice = 0;
		this.stalledAt = null;
		this.resumed = null;
		this.reads = new Map();
		this.lastRead = 0;
		this.controller = new AbortController();
		this.playable = new Promise((resolve, reject) => {
			this.onPlayable = resolve;
			this.onFailed = reject;
		});
		loadProcessor(context)
			.then(() => {
				this.controller.signal.throwIfAborted();
				this.node = new AudioWorkletNode(context, 'streamed-song', {numberOfInputs: 0, outputChannelCount: [2]});
				this.node.port.onmessage = ({data}) => this.receive(data);
				return this.load();
			})
			.catch(error => {
				if (this.node && !this.controller.signal.aborted) {
					this.node.port.postMessage({complete: true});
				}
				this.onFailed(error);
			});
	}

	get duration() {
		return this.mediaDuration || this.loadedFrames / this.context.sampleRate;
	}

	async load() {
		const response = await fetch(this.src, {signal: this.controller.signal});
		if (!response.ok) {
			throw new Error(`${response.status} ${this.src}`);
		}
		const total = +response.headers.get('content-length') || 0;
		let bytes = new Uint8Array(total || 1 << 20);
		let received = 0;
		let decoding = null;
		const reader = response.body.getReader();
		while (true) {
			const {done, value} = await reader.read();
			if (done) {
				break;
			}
			if (received + value.length > bytes.length) {
				const grown = new Uint8Array(Math.max(bytes.length * 2, received + value.length));
				grown.set(bytes.subarray(0, received));
				bytes = grown;
			}
			bytes.set(value, received);
			received += value.length;

			const due =
				received >= Math.max(FIRST_DECODE, this.decodedBytes * 2) ||
				(this.stalledAt !== null && received >= this.bytesUntil(this.stalledAt + 2, total));
			if (due && !decoding) {
				decoding = this.decode(bytes, received, false).finally(() => (decoding = null));
			}
		}
		await decoding;
		await this.decode(bytes, received, true);
	}

	bytesUntil(seconds, total) {
		const estimate = total && this.mediaDuration ? (seconds / this.mediaDuration) * total : 0;
		return Math.max(estimate, this.decodedBytes * 1.05 + STALL_DECODE);
	}

	async decode(bytes, length, final) {
		const end = final ? length : decodableLength(bytes, length);
		if (!end) {
			return;
		}
		this.decodedBytes = end;
		let buffer;
		try {
			buffer = await this.context.decodeAudioData(bytes.slice(0, end).buffer);
		} catch (error) {
			if (final) throw error;
			return;
		}
		if (this.controller.signal.aborted) {
			return;
		}
		const usable = final ? buffer.length : buffer.length - SAFE_TAIL;
		if (usable > this.sentFrames) {
			const chunk = [];
			for (let c = 0; c < buffer.numberOfChannels; c++) {
				chunk.push(buffer.getChannelData(c).slice(this.sentFrames, usable));
			}
			this.sentFrames = usable;
			this.node.port.postMessage(
				{chunk},
				chunk.map(channel => channel.buffer)
			);
		}
		if (final) {
			this.node.port.postMessage({complete: true});
		}
	}

	read(from, length) {
		if (!this.node || from + length > this.loadedFrames) {
			return Promise.resolve(null);
		}
		const id = ++this.lastRead;
		return new Promise(resolve => {
			this.reads.set(id, resolve);
			this.node.port.postMessage({read: {id, from, length}});
		});
	}

	receive({loaded, complete, stalled, playing, position, time, read, samples}) {
		if (read !== undefined) {
			const resolve = this.reads.get(read);
			this.reads.delete(read);
			if (resolve) resolve(samples);
			return;
		}
		if (loaded !== undefined) {
			this.loadedFrames = loaded;
			this.complete = complete;
			if (loaded || complete) {
				this.onPlayable();
			}
		}
		if (stalled === this.voice) {
			this.stalledAt = position;
		}
		if (playing === this.voice) {
			this.stalledAt = null;
			this.resumed = {position, time};
		}
	}

	createSource() {
		const song = this;
		const node = this.node;
		const id = ++this.voices;
		return {
			context: this.context,
			buffer: {
				get duration() {
					return song.duration;
				},
			},
			playbackRate: node.parameters.get('playbackRate'),
			get stalledAt() {
				return song.voice === id ? song.stalledAt : null;
			},
			takeResume() {
				const resumed = song.voice === id ? song.resumed : null;
				song.resumed = null;
				return resumed;
			},
			start(when = 0, offset = 0) {
				song.voice = id;
				song.resumed = null;
				song.stalledAt = !song.complete && offset * song.context.sampleRate >= song.loadedFrames - 1 ? offset : null;
				node.port.postMessage({start: {id, when, offset}});
			},
			stop(when = 0) {
				node.port.postMessage({stop: {id, when}});
			},
			connect(destination) {
				node.connect(destination);
				return destination;
			},
			disconnect() {
				try {
					node.disconnect();
				} catch (e) {}
			},
		};
	}

	release() {
		this.controller.abort();
		this.reads.forEach(resolve => resolve(null));
		this.reads.clear();
		if (this.node) {
			this.node.port.postMessage({release: true});
			this.node.port.onmessage = null;
			try {
				this.node.disconnect();
			} catch (e) {}
		}
	}
}

module.exports = {StreamedSong, supportsStreamedSong};
