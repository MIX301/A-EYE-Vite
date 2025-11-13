# A-EYE-Vite: Live Vision AI Assistant Documentation

## Table of Contents
1. [Project Overview](#project-overview)
2. [Architecture & Technology Stack](#architecture--technology-stack)
3. [System Workflow](#system-workflow)
4. [Key Components](#key-components)
5. [Design Decisions](#design-decisions)
6. [Development Iterations](#development-iterations)
7. [Tools & Dependencies](#tools--dependencies)
8. [Deployment & Configuration](#deployment--configuration)

---

## Project Overview

**A-EYE-Vite** is a Progressive Web Application (PWA) that provides real-time, multimodal AI interaction using Google's Gemini 2.5 Flash Native Audio API. The application enables users to engage in live voice conversations with an AI assistant while simultaneously streaming video from their device's camera. The system features sophisticated 3D WebGL visualizations that react to both input and output audio frequencies, creating an immersive, responsive user experience.

### Core Capabilities
- **Real-time audio streaming** (16kHz input, 24kHz output)
- **Live video frame capture** (2 FPS) for visual context
- **3D audio-reactive visualizations** using Three.js
- **Mobile-first PWA** with offline support
- **Secure HTTPS development** for mobile device testing

---

## Architecture & Technology Stack

### Frontend Framework
- **Lit** (v3.3.0): Web Components framework for building modular, reusable UI components
- **TypeScript**: Type-safe development with modern ES2022 features
- **Vite** (v6.2.0): Fast build tool and development server

### 3D Graphics & Visualization
- **Three.js** (v0.176.0): WebGL-based 3D rendering engine
- **Custom GLSL shaders**: Vertex and fragment shaders for real-time audio-reactive effects
- **EXR HDR environment mapping**: High dynamic range lighting for realistic material rendering

### AI Integration
- **@google/genai** (v1.15.0): Google Gemini Live API client
- **Model**: `gemini-2.5-flash-native-audio-preview-09-2025`
- **Voice**: Prebuilt "Zephyr" voice configuration

### Audio Processing
- **Web Audio API**: Native browser audio processing
- **ScriptProcessorNode**: Legacy API for audio buffer processing (buffer size: 4096)
- **AnalyserNode**: FFT-based frequency analysis (FFT size: 32)

### Build & Development
- **Vite PWA Plugin**: Service worker registration and manifest generation
- **mkcert**: Local HTTPS certificate generation for mobile testing
- **ESM Import Maps**: CDN-based dependency loading via esm.sh

---

## System Workflow

### 1. Initialization Phase

```
User Opens App → Component Mounts → Client Initialization
```

1. **Component Lifecycle**: The `GdmLiveAudio` Lit component initializes on first render
2. **Audio Context Setup**: 
   - Input context: 16kHz sample rate (optimized for speech recognition)
   - Output context: 24kHz sample rate (higher quality for TTS playback)
3. **Gemini Client Initialization**: Creates a Live API session with audio-only response modality
4. **Permission Checks**: Queries browser permissions API for microphone and camera access
5. **3D Scene Setup**: Initializes Three.js scene, camera, renderer, and post-processing pipeline

### 2. Session Start Workflow

```
User Taps "Tap to Speak" → Media Stream Acquisition → Audio/Video Processing → Live Session Active
```

1. **Media Stream Request**: 
   - Requests camera and microphone access via `getUserMedia()`
   - Prefers back camera (`facingMode: 'environment'`) for better real-world context
   - Falls back to device enumeration if ideal constraint fails
   - Applies audio constraints: echo cancellation, noise suppression, auto gain control

2. **Audio Pipeline Setup**:
   - Creates `MediaStreamSource` from microphone input
   - Connects to `ScriptProcessorNode` for buffer processing
   - Processes audio in 4096-sample chunks
   - Downsamples to 16kHz if necessary (using custom resampling algorithm)
   - Converts Float32 PCM to Int16 PCM for API transmission

3. **Video Pipeline Setup**:
   - Displays live video feed in background (top 66.67% of viewport)
   - Captures frames at 2 FPS interval (500ms)
   - Converts canvas frames to JPEG (80% quality) for bandwidth efficiency
   - Encodes as base64 for API transmission

4. **Live Session Activation**:
   - Sends real-time audio chunks via `session.sendRealtimeInput()`
   - Sends video frames as base64-encoded JPEGs
   - Receives audio responses as base64-encoded PCM data
   - Decodes and schedules audio playback with precise timing

### 3. Real-time Processing Loop

```
Audio Buffer → Downsample → Encode → Send to API
                                    ↓
Video Frame → Canvas Capture → JPEG Encode → Send to API
                                    ↓
API Response → Decode PCM → Schedule Playback → Update Visuals
```

**Audio Processing**:
- Continuous streaming: Audio chunks sent immediately upon capture
- Interruption handling: Server can signal interruption, stopping all queued audio
- Playback scheduling: Uses `nextStartTime` to prevent audio gaps and overlaps

**Video Processing**:
- Frame rate: 2 FPS (balance between context freshness and bandwidth)
- Compression: JPEG at 80% quality reduces payload size while maintaining visual clarity
- Canvas-based capture: Hidden canvas element for frame extraction

**Visualization Updates**:
- 60 FPS render loop using `requestAnimationFrame`
- Audio analysers update frequency data every frame
- 3D sphere deformation and camera rotation driven by audio frequencies
- Post-processing: Bloom effects and optional FXAA anti-aliasing

### 4. Session Management

**Stop Workflow**:
- Disconnects all audio nodes
- Stops media stream tracks
- Clears frame capture interval
- Closes WebSocket connection to Gemini API
- Resets session state

**Restart Workflow**:
- Reinitializes session promise
- Re-acquires media streams
- Resumes audio contexts
- Clears previous state

---

## Key Components

### 1. `index.tsx` - Main Application Component

**Purpose**: Orchestrates the entire application lifecycle, manages media streams, and handles user interactions.

**Key Responsibilities**:
- Gemini Live API session management
- Media stream acquisition and processing
- Audio encoding/decoding (PCM ↔ Float32)
- Video frame capture and encoding
- Error handling and status reporting
- User interaction handling (tap to start/stop)

**Design Patterns**:
- **State Management**: Lit's reactive `@state()` decorators for UI updates
- **Promise-based Session**: Lazy initialization of Live API session
- **Audio Scheduling**: Precise timing using `AudioContext.currentTime`

### 2. `visual-3d.ts` - 3D Audio Visualization

**Purpose**: Renders real-time 3D visualizations that react to audio input/output frequencies.

**Key Features**:
- **Icosahedron Geometry**: High-resolution sphere (10 subdivisions) for smooth deformation
- **Custom Vertex Shader**: Procedural sphere deformation based on audio data
- **HDR Environment Mapping**: EXR texture loading for realistic reflections
- **Dynamic Camera**: Orbital camera rotation driven by audio frequencies
- **Post-processing Pipeline**: Bloom effects for enhanced visual appeal

**Audio Integration**:
- Separate analysers for input (microphone) and output (AI response) audio
- Frequency data mapped to shader uniforms:
  - `inputData`: User's voice characteristics
  - `outputData`: AI response characteristics
  - `time`: Animated time value for procedural effects

**Performance Optimizations**:
- Reduced pixel ratio (`devicePixelRatio / 1`) for mobile performance
- Antialiasing disabled for faster rendering
- FXAA pass commented out (can be enabled for smoother edges)

### 3. `analyser.ts` - Audio Frequency Analysis

**Purpose**: Wraps Web Audio API's `AnalyserNode` for frequency domain analysis.

**Configuration**:
- FFT Size: 32 (provides 16 frequency bins)
- Analysis Type: Byte frequency data (0-255 range)
- Update Frequency: Called every animation frame (~60 FPS)

**Usage**: Provides real-time frequency spectrum data to visualization components.

### 4. `utils.ts` - Audio Encoding Utilities

**Purpose**: Handles conversion between different audio formats required by the API and Web Audio API.

**Key Functions**:
- `createBlob()`: Converts Float32Array PCM to Int16 PCM, then base64-encodes for API
- `decodeAudioData()`: Decodes base64 Int16 PCM to Float32Array AudioBuffer
- `encode/decode()`: Base64 encoding/decoding utilities

**Design Rationale**: The Gemini API expects Int16 PCM at specific sample rates, while Web Audio API uses Float32. These utilities bridge the gap.

### 5. Shader Components

#### `sphere-shader.ts` - Procedural Sphere Deformation

**Purpose**: Vertex shader that deforms the sphere geometry based on audio data.

**Technique**:
- Spherical coordinate system for smooth deformation
- Sine wave-based displacement along surface normals
- Separate contributions from input and output audio
- Normal recalculation for proper lighting

**Uniforms**:
- `time`: Animated time value
- `inputData`: User audio characteristics (x: intensity, y: modulation, z: frequency)
- `outputData`: AI audio characteristics

#### `backdrop-shader.ts` - Background Visualization

**Purpose**: Fragment shader for the background icosahedron mesh.

**Technique**:
- Radial gradient from center to edges
- Procedural noise for texture variation
- Aspect ratio correction for consistent appearance

### 6. `visual.ts` - Legacy 2D Visualization (Unused)

**Purpose**: Alternative 2D canvas-based visualization component (not currently used in the app).

**Note**: This component exists but is not imported or used, suggesting an iteration where 3D visualization replaced 2D.

---

## Design Decisions

### 1. **Lit Framework Over React**

**Decision**: Use Lit Web Components instead of React.

**Justification**:
- **Smaller Bundle Size**: Lit is significantly lighter than React, critical for mobile PWA
- **Native Web Standards**: Web Components are framework-agnostic and future-proof
- **Performance**: No virtual DOM overhead; direct DOM manipulation
- **Simplicity**: Component model is straightforward for this single-page application
- **PWA Compatibility**: Works seamlessly with service workers and offline capabilities

**Trade-offs**:
- Less ecosystem support compared to React
- Smaller community and fewer third-party components
- More manual DOM manipulation required

### 2. **ScriptProcessorNode (Legacy API)**

**Decision**: Use deprecated `ScriptProcessorNode` instead of `AudioWorklet`.

**Justification**:
- **Browser Compatibility**: ScriptProcessorNode has broader support, especially on mobile Safari
- **Simplicity**: Easier to implement and debug
- **Sufficient Performance**: For 2-channel audio at 16kHz, the overhead is acceptable

**Trade-offs**:
- Deprecated API (may be removed in future browsers)
- Runs on main thread (potential UI blocking)
- Less efficient than AudioWorklet

**Future Consideration**: Migration to AudioWorklet would improve performance and future-proof the application.

### 3. **2 FPS Video Frame Rate**

**Decision**: Capture and send video frames at 2 frames per second (500ms interval).

**Justification**:
- **Bandwidth Optimization**: Reduces data transfer significantly (from 30 FPS to 2 FPS = 93% reduction)
- **API Efficiency**: Gemini Live API doesn't require high frame rates for visual context
- **Battery Life**: Lower processing and transmission reduces mobile device power consumption
- **Sufficient Context**: 2 FPS provides adequate visual context for conversational AI

**Trade-offs**:
- Less responsive to rapid visual changes
- May miss brief visual events
- Slight delay in visual context updates

### 4. **Separate Audio Contexts for Input/Output**

**Decision**: Use two separate `AudioContext` instances with different sample rates.

**Justification**:
- **Input Optimization**: 16kHz is optimal for speech recognition (reduces bandwidth and processing)
- **Output Quality**: 24kHz provides better TTS audio quality
- **Independent Control**: Allows separate management of input and output audio streams
- **API Requirements**: Gemini API expects 16kHz input, provides 24kHz output

**Trade-offs**:
- More complex audio graph management
- Potential synchronization challenges (mitigated by precise scheduling)

### 5. **Three.js for 3D Visualization**

**Decision**: Use Three.js instead of WebGL directly or 2D canvas.

**Justification**:
- **Rich Ecosystem**: Extensive post-processing effects, loaders, and utilities
- **Developer Experience**: Higher-level abstractions reduce code complexity
- **Performance**: Optimized WebGL rendering pipeline
- **Feature Set**: Built-in support for HDR, bloom, and complex geometries

**Trade-offs**:
- Larger bundle size (~500KB+)
- Learning curve for complex 3D concepts
- Overkill for simple visualizations (but justified by rich effects)

### 6. **PWA Architecture**

**Decision**: Build as Progressive Web App with service worker support.

**Justification**:
- **Mobile Installation**: Users can install to home screen for app-like experience
- **Offline Capabilities**: Service worker enables offline functionality (future enhancement)
- **Performance**: Caching reduces load times
- **Cross-platform**: Single codebase works on iOS, Android, and desktop

**Trade-offs**:
- Requires HTTPS (or localhost) for service workers
- iOS PWA limitations (no background processing, limited APIs)
- Additional complexity in build configuration

### 7. **Custom Audio Resampling**

**Decision**: Implement custom downsampling algorithm instead of using Web Audio API's resampling.

**Justification**:
- **Control**: Precise control over resampling quality and method
- **Simplicity**: Avoids additional audio node complexity
- **Performance**: Lightweight algorithm suitable for real-time processing
- **Compatibility**: Works consistently across browsers

**Trade-offs**:
- May have lower quality than native browser resampling
- Requires maintenance of custom algorithm
- Potential for aliasing if not carefully implemented

### 8. **Base64 Encoding for Media**

**Decision**: Encode audio and video as base64 strings for API transmission.

**Justification**:
- **API Requirement**: Gemini Live API expects base64-encoded media
- **Simplicity**: No need for multipart form data or binary WebSocket frames
- **Compatibility**: Works reliably across all transport mechanisms

**Trade-offs**:
- ~33% size overhead compared to binary
- Additional encoding/decoding CPU overhead
- Not optimal for very large payloads

### 9. **Portrait Orientation Lock**

**Decision**: Configure PWA manifest for portrait-only orientation.

**Justification**:
- **Mobile-first**: Optimized for phone usage (primary use case)
- **UI Design**: Layout designed for vertical screen space
- **Consistency**: Prevents layout issues from orientation changes

**Trade-offs**:
- Limits flexibility for tablet users
- May frustrate users who prefer landscape

### 10. **HTTPS Development Server**

**Decision**: Support local HTTPS certificates via mkcert for mobile device testing.

**Justification**:
- **Mobile Testing**: Required for camera/microphone APIs on mobile devices
- **Service Worker**: HTTPS required for service worker registration
- **Real-world Testing**: Enables testing on actual devices over LAN

**Trade-offs**:
- Additional setup complexity
- Certificate management overhead
- Requires trust installation on devices

---

## Development Iterations

### Phase 1: Core Audio Functionality
**Focus**: Basic voice interaction with Gemini API

**Components**:
- Audio capture and streaming
- API integration
- Basic audio playback
- Simple UI for start/stop

**Outcomes**: Working prototype of voice-to-voice AI interaction

### Phase 2: Video Integration
**Focus**: Adding visual context to conversations

**Components**:
- Camera access and video display
- Frame capture and encoding
- Video frame transmission to API
- Background video display

**Outcomes**: Multimodal AI interaction with visual context

### Phase 3: 2D Visualization
**Focus**: Visual feedback for audio activity

**Components**:
- `visual.ts` component with canvas-based frequency visualization
- Dual-channel visualization (input/output audio)
- Gradient-based color schemes

**Outcomes**: Basic audio-reactive visual feedback

### Phase 4: 3D Visualization Upgrade
**Focus**: Enhanced visual experience with WebGL

**Components**:
- Migration to Three.js
- 3D sphere geometry with procedural deformation
- Custom GLSL shaders
- HDR environment mapping
- Post-processing effects (bloom)
- Dynamic camera movement

**Outcomes**: Immersive 3D audio-reactive visualization

### Phase 5: PWA Optimization
**Focus**: Mobile-first experience and offline capabilities

**Components**:
- Service worker integration
- PWA manifest configuration
- HTTPS development server support
- Mobile-specific UI adjustments (safe areas, viewport)
- Home screen installation support

**Outcomes**: Production-ready mobile PWA

### Phase 6: Polish & Refinement
**Focus**: User experience improvements and bug fixes

**Components**:
- Error handling and status messages
- Session management (restart, stop)
- Permission handling
- Back camera preference logic
- Audio interruption handling
- Performance optimizations

**Outcomes**: Robust, user-friendly application

---

## Tools & Dependencies

### Development Tools

**Vite**:
- Fast HMR (Hot Module Replacement) for rapid development
- Optimized production builds
- Plugin ecosystem (PWA support)
- Environment variable handling

**TypeScript**:
- Type safety and IntelliSense
- Modern ES2022 features
- Decorator support for Lit components
- Path aliases for cleaner imports

**mkcert**:
- Local HTTPS certificate generation
- Trusted certificates for development
- Simplified mobile device testing

### Runtime Dependencies

**@google/genai**:
- Official Google Gemini API client
- Live API WebSocket management
- Media encoding/decoding utilities
- Type definitions for TypeScript

**lit**:
- Web Components framework
- Reactive state management
- Shadow DOM encapsulation
- Template literal-based rendering

**three**:
- 3D graphics library
- WebGL abstraction
- Scene graph management
- Post-processing pipeline

### Build Dependencies

**vite-plugin-pwa**:
- Service worker generation
- Manifest file management
- Offline asset caching
- Update notifications

**@types/node**:
- TypeScript definitions for Node.js APIs
- Used for file system operations in Vite config

### CDN Dependencies (via Import Maps)

The project uses ESM import maps to load dependencies from CDN:
- Reduces bundle size
- Enables faster development (no npm install needed for these)
- Version pinning via esm.sh

**Dependencies Loaded via CDN**:
- `lit` and `lit/` - Web Components framework
- `@lit/context` - Context API for Lit
- `@google/genai` - Gemini API client
- `three` and `three/` - 3D graphics library

---

## Deployment & Configuration

### Environment Variables

**Required**:
- `GEMINI_API_KEY`: Google Gemini API key for authentication

**Optional**:
- `LAN_HOST`: IP address for HMR on mobile devices (e.g., `192.168.1.50`)

### Build Configuration

**Vite Config** (`vite.config.ts`):
- Port: 3000
- Host: `0.0.0.0` (accessible on LAN)
- HTTPS: Auto-detected if certificates exist in `certs/`
- HMR: WebSocket-based with protocol detection (ws/wss)

**PWA Manifest**:
- Name: "Live Vision"
- Display: Standalone (app-like experience)
- Orientation: Portrait
- Theme: Black (#000000)

### Mobile Testing Setup

1. **Generate Certificates**:
   ```bash
   mkcert -key-file certs/dev.key -cert-file certs/dev.crt 192.168.x.x my-mac.local
   ```

2. **Trust Certificate on Device**:
   - AirDrop `rootCA.pem` from `$(mkcert -CAROOT)`
   - Install and trust in Settings → General → About → Certificate Trust Settings

3. **Start Development Server**:
   ```bash
   npm run dev
   ```

4. **Access on Mobile**:
   - Open `https://192.168.x.x:3000` in Safari
   - Grant camera/microphone permissions
   - Add to Home Screen for PWA experience

### Production Build

```bash
npm run build
```

Output: `dist/` directory with optimized assets, service worker, and manifest.

---

## Future Considerations

### Potential Enhancements

1. **AudioWorklet Migration**: Replace ScriptProcessorNode with AudioWorklet for better performance
2. **Offline Mode**: Implement service worker caching for offline functionality
3. **Multiple Voice Options**: Allow users to select different AI voices
4. **Visual Customization**: User-configurable visualization parameters
5. **Conversation History**: Store and display conversation transcripts
6. **Error Recovery**: Automatic reconnection on network failures
7. **Performance Monitoring**: Add analytics for frame rates and audio latency
8. **Accessibility**: Enhanced screen reader support and keyboard navigation

### Technical Debt

1. **Legacy Audio API**: ScriptProcessorNode should be migrated to AudioWorklet
2. **Unused Components**: `visual.ts` (2D visualization) could be removed or integrated
3. **Error Handling**: More granular error messages and recovery strategies
4. **Type Safety**: Some `any` types could be properly typed
5. **Testing**: No test suite currently exists

---

## Conclusion

A-EYE-Vite represents a sophisticated integration of modern web technologies to create an immersive, real-time AI interaction experience. The architecture prioritizes mobile performance, user experience, and visual appeal while maintaining code simplicity and maintainability. Key design decisions around audio processing, visualization, and PWA architecture enable a production-ready application that demonstrates the potential of multimodal AI interfaces in web browsers.

The iterative development process shows a clear evolution from basic functionality to a polished, feature-rich application, with each phase building upon previous work while introducing new capabilities. The use of Web Components, Three.js, and the Gemini Live API creates a powerful foundation for future enhancements and scalability.

