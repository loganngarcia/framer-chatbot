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

| Prop | Type | Description |
|------|------|-------------|
| `geminiApiKey` | string | Your Gemini API key (required) |
| `model` | string | Gemini model ID (default: "gemini-2.5-flash-lite") |
| `systemPrompt` | string | AI personality and behavior instructions |
| `welcomeMessage` | string | Initial greeting message |
| `placeholder` | string | Input field placeholder |
| `reasoningEffort` | "none" \| "low" \| "medium" \| "high" | AI thinking depth |

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
