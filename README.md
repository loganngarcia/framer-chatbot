# Framer Chatbot

A Framer component that brings Google's Gemini AI chatbot to your designs with a beautiful, customizable interface.

## Features

- **AI-Powered Chat**: Powered by Google's Gemini models with streaming responses
- **Multimodal Input**: Text, image, video, audio, and file upload support
- **Rich Interactions**: Markdown rendering, text-to-speech, and copy functions
- **Mobile Optimized**: Touch-friendly with gesture controls
- **Fully Customizable**: Colors, fonts, animations, and layout
- **Framer Native**: Seamless integration with Framer's design tools

## Quick Start

### 1. Get API Key
Visit [Google AI Studio](https://aistudio.google.com/apikey) and create an API key.

### 2. Add to Framer
Copy `gemini.tsx` to your Framer project's components directory.

### 3. Basic Usage
```tsx
import ChatOverlay from "./gemini"

<ChatOverlay
  geminiApiKey="your-api-key-here"
  systemPrompt="You are a helpful assistant."
  welcomeMessage="Hi! How can I help you today?"
/>
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `geminiApiKey` | string | - | Your Gemini API key (required) |
| `model` | string | "gemini-2.5-flash-lite" | Gemini model ID |
| `reasoningEffort` | enum | "none" | AI thinking depth: "none", "low", "medium", "high" |
| `systemPrompt` | string | "You are a helpful assistant." | AI personality and behavior instructions |
| `welcomeMessage` | string | "Hi, how can I help?" | Initial greeting message |
| `placeholder` | string | "Ask anything" | Input field placeholder |
| `enableAiSuggestions` | boolean | true | Generate AI contextual reply suggestions |
| `suggestedReply1` | string | "Quick facts" | First static suggested reply |
| `suggestedReply2` | string | "Proven metrics" | Second static suggested reply |
| `suggestedReply3` | string | "Contact" | Third static suggested reply |
| `enableScrollReveal` | boolean | true | Scale input bar in from bottom on scroll |
| `universalBorderRadius` | number | 24 | Corner radius for all elements (0-50px) |
| `textFont` | font | Inter, 16px | Font family, size, weight, and style |
| `textColor` | color | rgba(0,0,0,0.95) | Text color for input and messages |
| `placeholderTextColor` | color | rgba(0,0,0,0.45) | Placeholder text color |
| `linkColor` | color | #007AFF | Hyperlink color |
| `iconColor` | color | rgba(0,0,0,0.65) | General icon color |
| `userMessageBackgroundColor` | color | rgba(0,20,41,0.08) | User message bubble background |
| `chatAreaBackground` | color | #F5F5F5 | Main chat area background |
| `inputBarBackground` | color | rgba(255,255,255,0.70) | Collapsed input bar background |
| `expandedInputAreaBackground` | color | rgba(255,255,255,0.95) | Expanded input area background |
| `sendBgColor` | color | rgba(0,0,0,0.95) | Send button background color |
| `sendIconColor` | color | #FFFFFF | Send button icon color |
| `shadow` | boolean | true | Enable/disable shadows |
| `sendIconOverrideUrl` | image | - | Custom send button icon |
| `loadingIconOverrideUrl` | image | - | Custom loading indicator icon |

## Advanced Usage

### Customer Support Bot
```tsx
<ChatOverlay
  geminiApiKey="your-api-key"
  systemPrompt="You are a customer support assistant for TechCorp."
  welcomeMessage="Welcome to TechCorp Support!"
  suggestedReply1="Check order status"
  suggestedReply2="Return an item"
/>
```

### Educational Assistant
```tsx
<ChatOverlay
  geminiApiKey="your-api-key"
  systemPrompt="You are an educational assistant specializing in mathematics."
  model="gemini-2.5-flash-lite"
  reasoningEffort="medium"
/>
```

## Requirements

- Framer account
- Google Gemini API key
- Modern browser with JavaScript enabled

## License

Provided as-is for use in Framer projects. Comply with Google's Gemini API terms of service.
