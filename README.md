# SillyTavern Extension Example

*Provide a brief description of how your extension works, what problem it aims to solve.*

## Features

*Describe some of the main selling points of your extension.*

### Clothing inclusion rules

| Prompt type | Included clothing scope | Notes |
| --- | --- | --- |
| Character description generation | Everything | Includes full clothing context (including covered/underneath context where applicable). |
| Image prompt generation (portrait/scene/etc.) | Visible only | Hidden/covered items are not included. |
| Image-generator prompt helper/completion | Visible only | Always text-oriented summary of visible clothing only. |
| Chat message injection | Everything | Injected clothing context includes full state for continuity. |

### Chat history filtering for extension LLM requests

- Messages marked as invisible for AI (ghost icon in UI) are excluded from chat history sent by this extension.
- History limit is counted by assistant replies; user/system messages between those replies are included.

## Installation and Usage

### Installation

*In most cases, this should just be using ST's inbuilt extension installer.* 

### Usage

*Explain how to use this extension.*

## Prerequisites

*Specify the version of ST necessary here.*

## Support and Contributions

*Where should someone ask for support?*

*Consider including your own contact info for help/questions.*

*How can people help add to this extension?*

## License

*Be cool, use an open source license.*
