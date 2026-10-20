function element(tag, className, text) {
	const el = document.createElement(tag);
	if (className) el.className = className;
	if (text !== undefined) el.textContent = text;
	return el;
}

function icon(name, style = 'fas') {
	return element('i', `${style} ${name}`);
}

function iconButton(name, title) {
	const button = element('button', 'playlistIconButton');
	button.type = 'button';
	button.title = title;
	button.append(icon(name));
	return button;
}

function image(className, src) {
	const img = element('img', className);
	img.src = src || '';
	img.alt = '';
	img.draggable = false;
	return img;
}

function plural(count, word) {
	return `${count} ${word}${count === 1 ? '' : 's'}`;
}

module.exports = {element, icon, iconButton, image, plural};
