let queryParamTime = AFRAME.utils.getUrlParameter('time').trim();
if (!queryParamTime || isNaN(queryParamTime)) {
	queryParamTime = undefined;
} else {
	queryParamTime = parseFloat(queryParamTime) / 1000;
}

module.exports.queryParamTime = queryParamTime;
