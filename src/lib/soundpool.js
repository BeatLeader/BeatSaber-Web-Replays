/* global Audio */
module.exports = function SoundPool (src, volume) {
  var currSound = 0;
  var pool = [];
  var sound;

  sound = new Audio(src);
  sound.volume = volume;
  pool.push(sound);

  return {
    play: function (volume) {
      // Dynamic size pool.
      if (pool[currSound].currentTime !== 0 || !pool[currSound].ended) {
        sound = new Audio(src);
        sound.volume = volume;
        pool.push(sound);
        currSound++;
      }

      if (pool[currSound].currentTime === 0 || pool[currSound].ended) {
        pool[currSound].volume = volume;
        pool[currSound].play();
      }
      currSound = (currSound + 1) % pool.length;
    }
  };
};
