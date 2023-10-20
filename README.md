# Beat Saber Web Replays

[![Netlify Status](https://api.netlify.com/api/v1/badges/08ead0d0-ade4-4f38-8af4-9b6c3c679234/deploy-status)](https://app.netlify.com/sites/musing-aryabhata-6ae6ea/deploys)

[A-Frame]: https://github.com/nsgolova/ngoframe
[visit]: https://replay.beatleader.xyz/?scoreId=8931530

Web-based viewer for Beat Saber replays, built with [A-Frame] and JavaScript.

**[CLICK TO VIEW][visit]**

![https://replay.beatleader.xyz/?scoreId=8931530](assets/img/preview.png)

## Community

- [BeatLeader Discord](https://discord.gg/2RG5YVqtG6)

_The Beat Saber Web Replays is an unofficial community project and not officially
affiliated with Beat Saber._

## Usage

Go to the [BeatLeader](https://beatleader.xyz) and click on dancing pepe icon in the leaderboard.

Or if you have a site, you can I-Frame the viewer and pass a query parameter
containing the BeatLeader's score ID:

`https://replay.beatleader.xyz/?scoreId=9280912`

To directly link to a sought time, use the `?time` parameter in the URL (milliseconds, int, 0 to song duration):

`https://replay.beatleader.xyz/?scoreId=9280912&time=15000` - 15 sec

To specify replay speed use the `?speed` parameter in the URL (percent, int, 0 to 200):

`https://replay.beatleader.xyz/?scoreId=9280912&speed=50` - 50% speed

To specify notes jump distance use the `?jd` parameter in the URL (meters, float, 5 to 50):

`https://replay.beatleader.xyz/?scoreId=9280912&jd=18.6` - 18.6 JD

To specify replay download link use the `?link` parameter in the URL. Make sure the link(name of the file) contains playerID:

`https://replay.beatleader.xyz/?link=https://cdn.replays.beatleader.xyz/9280912-76561198059961776-ExpertPlus-Standard-13400F5FB2FD19F52E8C7AC48815D12E72FA3B4A.bsor`

## Development

Download repository.
The best way to download it is to use the "Clone" button in [SourceTree app](https://www.sourcetreeapp.com/)

Go to the project directory in the terminal and type.

```
npm install
```

If you don't have NodeJS - download it here first: https://nodejs.org/en/  
Version 16 or greater (LTS) is recommended; some developers have experienced issues with older Node versions.

### Starting local build

Install netlify-cli(one time setup):

```bash
npm install netlify-cli -g
```

Start Netlify dev environment(every time):

```bash
netlify dev
```

Navigate to [localhost:9999](http://localhost:9999). You should see the app running.
Website will reload automatically after you save your changes.

### Contributing

- Create a fork ("Fork" button on top) or ask me in [Discord](https://discord.gg/2RG5YVqtG6) to add you to this repository as a developer if you plan to contribute often.
- Create work branch ("nsgolova/lightImprovements" for example). You can push to the master in your fork, but not in the main repository.
- Commit and push your changes.
- Open a pull request. Netlify will deploy a stage website for your fork and you can test it out.
- Your pull request would be merged and changes will deploy to the website!

### A-Frame build (optional)

This project uses a custom A-Frame fork: https://github.com/nsgolova/ngoframe
It's prebuilt and can be found in the \vendor folder.

To build it

```bash
npm install
npm run dist
```

Copy files from \dist folder of A-Frame to \vendor folder here.

### Replay Format

Uses [Open Replay Format](https://github.com/BeatLeader/BS-Open-Replay)

### Building and running in production mode

By default, Netlify builds the app after every change to this branch in the repository, so all you need is push to git.

## Roadmap

- Settings UI improvement
- A-Frame update to the latest version
- Custom saber support
