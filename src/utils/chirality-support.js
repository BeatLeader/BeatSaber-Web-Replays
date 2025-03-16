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

function compareSlider(note, slider, tail) {
	if (note._time.toFixed(2) != slider[`_${tail ? 'tailT' : 't'}ime`].toFixed(2)) return false;

	if (note._lineIndex == slider[`_${tail ? 'tailL' : 'l'}ineIndex`] && note._lineLayer == slider[`_${tail ? 'tailL' : 'l'}ineLayer`])
		return true;

	if (note._customData && note._customData._position) {
		if (slider._customData && slider._customData[`_${tail ? 'tailP' : 'p'}osition`]) {
			if (
				note._customData._position[0].toFixed(2) == slider._customData[`_${tail ? 'tailP' : 'p'}osition`][0].toFixed(2) &&
				note._customData._position[1].toFixed(2) == slider._customData[`_${tail ? 'tailP' : 'p'}osition`][1].toFixed(2)
			)
				return true;
		} else {
			if (
				Math.round(note._customData._position[0] + 4 / 2) == slider[`_${tail ? 'tailL' : 'l'}ineIndex`] &&
				Math.round(note._customData._position[1]) == slider[`_${tail ? 'tailL' : 'l'}ineLayer`]
			)
				return true;
		}
	}

	return false;
}

function Mirror_Horizontal(beatmap, numberOfLines, flip_lines, remove_walls) {
	beatmap._burstSliders.forEach(note => {
		if (!flip_lines && note._cutDirection != horizontal_cut_transform(note._cutDirection)) {
			var head = beatmap._notes.find(n => compareSlider(n, note));
			if (head) {
				head._lineIndex = note._tailLineIndex;
			}

			var tailLineIndex = note._tailLineIndex;
			note._tailLineIndex = note._lineIndex;
			note._lineIndex = tailLineIndex;
		}
		Mirror_Horizontal_Note(note, numberOfLines, flip_lines);
		Mirror_Horizontal_Slider(note, numberOfLines, flip_lines);
	});

	beatmap._notes.forEach(note => {
		if (note._type != 0 && note._type != 1) {
			if (flip_lines) {
				note._lineIndex = numberOfLines - 1 - note._lineIndex;
			}
		} else {
			Mirror_Horizontal_Note(note, numberOfLines, flip_lines);
		}

		if (note._customData && note._customData._position) {
			note._customData._position[0] = numberOfLines - note._customData._position[0] - 5;
		}

		if (note._customData && note._customData._cutDirection) {
			note._customData._cutDirection = -1 * note._customData._cutDirection;
		}
	});

	beatmap._sliders.forEach(note => {
		Mirror_Horizontal_Note(note, numberOfLines, flip_lines);
		Mirror_Horizontal_Slider(note, numberOfLines, flip_lines);
	});

	beatmap._events.forEach(event => {
		if (event._type == 15 || event._type == 14) {
			event._inverted = !event._inverted;
		}
	});

	if (!remove_walls) {
		beatmap._obstacles.forEach(obstacle => {
			Mirror_Horizontal_Obstacle(obstacle, numberOfLines, flip_lines);
		});
	}
}

function Mirror_Vertical(beatmap, flip_rows, remove_walls) {
	beatmap._burstSliders.forEach(note => {
		if (!flip_rows && note._cutDirection != vertical_cut_transform(note._cutDirection)) {
			var head = beatmap._notes.find(n => compareSlider(n, note));
			if (head) {
				head._lineLayer = note._tailLineLayer;
			}

			var tailLineLayer = note._tailLineLayer;
			note._tailLineLayer = note._lineLayer;
			note._lineLayer = tailLineLayer;
		}
		Mirror_Vertical_Note(note, flip_rows);
		Mirror_Vertical_Slider(note, flip_rows);
	});

	beatmap._notes.forEach(note => {
		if (note._type != 0 && note._type != 1) {
			if (flip_rows) {
				note._lineLayer = 3 - 1 - note._lineLayer;
			}
		} else {
			Mirror_Vertical_Note(note, flip_rows);
		}
	});

	beatmap._sliders.forEach(note => {
		Mirror_Vertical_Note(note, flip_rows);
		Mirror_Vertical_Slider(note, flip_rows);
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
		if (note._lineIndex <= -1000 || note._lineIndex >= 1000) {
			h_line = (numberOfLines - 1) * 1000 - note._lineIndex;
			if (h_line >= 0 && h_line < numberOfLines * 1000) {
				h_line += 2000;
			}
		} else {
			h_line = numberOfLines - 1 - note._lineIndex;
		}
	} else {
		h_line = note._lineIndex;
		color = note._type;
	}

	if (note._flipLineIndex !== undefined) {
		let h_flip_line;
		if (flip_lines) {
			h_flip_line = numberOfLines - 1 - note._flipLineIndex;
		} else {
			h_flip_line = note._flipLineIndex;
		}

		note._flipLineIndex = h_flip_line;
	}

	note._type = color;
	note._lineIndex = h_line;

	note._cutDirection = horizontal_cut_transform(note._cutDirection);

	if (note.cutDirectionAngleOffset) {
		note.cutDirectionAngleOffset = -note.cutDirectionAngleOffset;
	}

	if (note._angleOffset) {
		note._angleOffset = -note._angleOffset;
	}
}

function Mirror_Horizontal_Slider(note, numberOfLines, flip_lines) {
	if (note._tailCutDirection) {
		note._tailCutDirection = horizontal_cut_transform(note._tailCutDirection);
	}
	if (note._headCutDirection) {
		note._headCutDirection = horizontal_cut_transform(note._headCutDirection);
	}

	let h_line;
	if (flip_lines) {
		h_line = numberOfLines - 1 - note._tailLineIndex;
	} else {
		h_line = note._tailLineIndex;
	}

	note._tailLineIndex = h_line;
}

function Mirror_Horizontal_Obstacle(obstacle, numberOfLines, flip_lines) {
	if (flip_lines) {
		if (obstacle._lineIndex <= -1000 || obstacle._lineIndex >= 1000) {
			var width = obstacle._width;
			if (width < 1000) {
				width *= 1000;
			}
			var lineIndex = (numberOfLines - 1) * 1000 - width - obstacle._lineIndex;
			obstacle._lineIndex = lineIndex + 2000;
		} else {
			obstacle._lineIndex = numberOfLines - obstacle._width - obstacle._lineIndex;
		}

		if (obstacle._customData && obstacle._customData._position) {
			obstacle._customData._position[0] = numberOfLines - obstacle._customData._position[0] - 5;

			if (obstacle._width > 1) {
				obstacle._width *= -1;
				obstacle._customData._position[0] += 1;
			}

			if (obstacle._customData._scale && obstacle._customData._scale[0] > 1) {
				obstacle._customData._position[0] += -1 * (obstacle._customData._scale[0] - 1);
			}
		}
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

function Flip_Note_Layer(note) {
	note._lineLayer = 3 - 1 - note._lineLayer;
}

function Mirror_Vertical_Note(note, flip_rows) {
	if (flip_rows) {
		Flip_Note_Layer(note);
	}
	note._cutDirection = vertical_cut_transform(note._cutDirection);
}

function Flip_Slider_Layer(note) {
	note._tailLineLayer = 3 - 1 - note._tailLineLayer;
}

function Mirror_Vertical_Slider(note, flip_rows) {
	if (note._tailCutDirection) {
		note._tailCutDirection = vertical_cut_transform(note._tailCutDirection);
	}
	if (note._headCutDirection) {
		note._headCutDirection = vertical_cut_transform(note._headCutDirection);
	}

	if (flip_rows) {
		Flip_Slider_Layer(note);
	}
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
module.exports.horizontal_cut_transform = horizontal_cut_transform;
module.exports.Mirror_Horizontal_Note = Mirror_Horizontal_Note;
