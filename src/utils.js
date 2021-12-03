const BASE_URL = 'https://saber.supermedium.com';

function getS3FileUrl (id, name) {
  return `${BASE_URL}/${id}-${name}?v=1`;
}
function beatsaverCdnCors(url) {
  return url.replace('https://eu.cdn.beatsaver.com/', '/cors/beat-saver-cdn/');
}
module.exports.getS3FileUrl = getS3FileUrl;
module.exports.beatsaverCdnCors = beatsaverCdnCors;
