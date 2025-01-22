# aiconn

[![npm (tag)](https://img.shields.io/npm/v/aiconn)](https://www.npmjs.com/package/aiconn)

>Handle LLM API requests in one place. Designed for speed and ease of use.

## Features

- 🎯 **Simple**: Minimal configuration required
- **deepseek-v3** and **deepseek-r1** Support
- 🚀 **Fast**: Built on H3, a high-performance server framework
~~- 🔄 **Flexible**: Support for multiple LLM providers~~

## Why

This package acts as a bridge (proxy) between DeepSeek and Cursor, allowing us to use Composer and ensuring it works as expected, like any other API model in Cursor

>Hint: Cursor now supports 'DeepSeek-v3' in pro, so you don't need to use it via the API.

## Prerequisites

1. Create an API Key at [Deepseek Platform](https://platform.deepseek.com/api_keys)
2. Signup for a free account on [ngrok](https://ngrok.com)

## Usage

Start a terminal
```
npx aiconn
```
or
```
npm -g aiconn
```

>Cursor doesn't allow localhost as a base URL, so we need to create a reverse proxy. You can use Ngrok for example:

Start another terminal
```
ngrok http 6000
```

You will see your server address in the terminal

![ngrok settings cursor](/public/ngrok.png)

Setup Cursor like the following

> Note: We can't use the real names for deepseek here since Cursor will throw an error. So we "emulate" it with gpt-4 and gpt-3.5-turbo

| Cursor Model Name | Deepseek Model |
|------------------|----------------|
| gpt-3.5-turbo    | deepseek-v3    |
| gpt-4            | deepseek-r1    |


![deepseek r1 cursor settings](/public/cursor_settings.png)


## Options

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--hostname` | Hostname to bind to | `0.0.0.0` |
| `--port` | Port to run server on | `6000` |


## What is the problem with deepseek API in Cursor?

If you add the deepseek API and the "deepseek-reasoning" r1 model the experience is not really great:

- No active .cursorrules / "Rules for AI" allowed
- Only Chat support (No Composer)

## License

MIT 

## Links

- X/Twitter: [@kregenrek](https://x.com/kregenrek)
- Bluesky: [@kevinkern.dev](https://bsky.app/profile/kevinkern.dev)

## Courses
- Learn Cursor AI: [Ultimate Cursor Course](https://www.instructa.ai/en/cursor-ai)
- Learn to build software with AI: [AI Builder Hub](https://www.instructa.ai/en/ai-builder-hub)

## See my other projects:

* [codefetch](https://github.com/regenrek/codefetch) - Turn code into Markdown for LLMs with one simple terminal command
* [aidex](https://github.com/regenrek/aidex) A CLI tool that provides detailed information about AI language models, helping developers choose the right model for their needs.
* [codetie](https://github.com/codetie-ai/codetie) - XCode CLI

## Credits

[unjs](https://github.com/unjs) - for bringing us the best javascript tooling system


