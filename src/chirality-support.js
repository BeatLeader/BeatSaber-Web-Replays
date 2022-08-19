const NoteCutDirection = {
	Up: 0,
	Down: 1,
	Left: 2,
	Right: 3,
	UpLeft: 4,
	UpRight: 5,
	DownLeft: 6,
	DownRight: 7,
	Any: 8,
	None: 9,
};

function Mirror_Inverse(event, numberOfLines, flip_lines, flip_rows, remove_walls) {
	Mirror_Horizontal(event, numberOfLines, flip_lines, remove_walls);
	Mirror_Vertical(event, flip_rows, remove_walls);
}

function Mirror_Horizontal(beatmap, numberOfLines, flip_lines, remove_walls) {
	beatmap._notes.forEach(note => {
		if (note._type != 0 && note._type != 1) {
			if (flip_lines) {
				note._lineIndex = numberOfLines - 1 - note._lineIndex;
			}
		} else {
			Mirror_Horizontal_Note(note, numberOfLines, flip_lines);
			if (note.sliderhead) {
				Mirror_Horizontal_Slider(note.sliderhead, numberOfLines, flip_lines);
			}
		}
	});

	beatmap._sliders.forEach(note => {
		Mirror_Horizontal_Note(note, numberOfLines, flip_lines);
		Mirror_Horizontal_Slider(note, numberOfLines, flip_lines);
	});
	beatmap._chains.forEach(note => {
		Mirror_Horizontal_Note(note, numberOfLines, flip_lines);
		Mirror_Horizontal_Slider(note, numberOfLines, flip_lines);
	});

	if (!remove_walls) {
		beatmap._obstacles.forEach(obstacle => {
			Mirror_Horizontal_Obstacle(obstacle, numberOfLines, flip_lines);
		});
	}
}

function Mirror_Vertical(beatmap, flip_rows, remove_walls) {
	beatmap._notes.forEach(note => {
		if (note._type != 0 && note._type != 1) {
			if (flip_rows) {
				note._lineLayer = 3 - 1 - note._lineLayer;
			}
		} else {
			Mirror_Vertical_Note(note, flip_rows);
		}
	});

	if (!remove_walls) {
		beatmap._obstacles.forEach(obstacle => {
			Mirror_Vertical_Obstacle(obstacle, flip_rows);
		});
	}
}

function horizontal_cut_transform(direction) {
	switch (direction) {
		case NoteCutDirection.UpLeft:
			return NoteCutDirection.UpRight;
		case NoteCutDirection.DownLeft:
			return NoteCutDirection.DownRight;
		case NoteCutDirection.UpRight:
			return NoteCutDirection.UpLeft;
		case NoteCutDirection.DownRight:
			return NoteCutDirection.DownLeft;
		case NoteCutDirection.Left:
			return NoteCutDirection.Right;
		case NoteCutDirection.Right:
			return NoteCutDirection.Left;
		default:
			break;
	}

	return direction;
}

function Mirror_Horizontal_Note(note, numberOfLines, flip_lines) {
	let color;
	if (note._type == 0) {
		color = 1;
	} else {
		color = 0;
	}

	let h_line;
	if (flip_lines) {
		h_line = numberOfLines - 1 - note._lineIndex;
	} else {
		h_line = note._lineIndex;
		color = note._type;
	}

	note._type = color;
	note._lineIndex = h_line;
	note._cutDirection = horizontal_cut_transform(note._cutDirection);
}

function Mirror_Horizontal_Slider(note, numberOfLines, flip_lines) {
	let h_line;
	if (flip_lines) {
		h_line = numberOfLines - 1 - note._tailLineIndex;
	} else {
		h_line = note._tailLineIndex;
	}

	note._tailLineIndex = h_line;
	if (note._tailCutDirection) {
		note._tailCutDirection = horizontal_cut_transform(note._tailCutDirection);
	}
	if (note._headCutDirection) {
		note._headCutDirection = horizontal_cut_transform(note._headCutDirection);
	}
}

function Mirror_Horizontal_Obstacle(obstacle, numberOfLines, flip_lines) {
	if (flip_lines) {
		obstacle._lineIndex = numberOfLines - obstacle._width - obstacle._lineIndex;
	}
}

function vertical_cut_transform(direction) {
	switch (direction) {
		case NoteCutDirection.Up:
			return NoteCutDirection.Down;
		case NoteCutDirection.Down:
			return NoteCutDirection.Up;
		case NoteCutDirection.UpLeft:
			return NoteCutDirection.DownLeft;
		case NoteCutDirection.DownLeft:
			return NoteCutDirection.UpLeft;
		case NoteCutDirection.UpRight:
			return NoteCutDirection.DownRight;
		case NoteCutDirection.DownRight:
			return NoteCutDirection.UpRight;
		default:
			break;
	}

	return direction;
}

function Mirror_Vertical_Note(note, flip_rows) {
	let v_layer;

	if (flip_rows) {
		v_layer = 3 - 1 - note._lineLayer;
	} else {
		v_layer = note._lineLayer;
	}

	note._lineLayer = v_layer;
	note._cutDirection = vertical_cut_transform(note._cutDirection);
}

function Mirror_Vertical_Obstacle(obstacle, flip_rows) {
	if (flip_rows) {
		obstacle._width = 0;
		obstacle._lineIndex = 0;
		obstacle._lineLayer = 0;
		obstacle._duration = 0;
		obstacle._height = 0;
	}
}

module.exports.Mirror_Inverse = Mirror_Inverse;
module.exports.Mirror_Horizontal = Mirror_Horizontal;
module.exports.Mirror_Vertical = Mirror_Vertical;
