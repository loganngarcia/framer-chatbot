import * as React from "react"
import { addPropertyControls, ControlType } from "framer"

/**
 * PROJECT: Omegle for Mentorship
 * ORGANIZATION: Curastem (501(c)(3) non-profit)
 * DESCRIPTION: A real-time video platform connecting students with mentors.
 * Built as a Framer Code Component using PeerJS for WebRTC and MQTT for signaling.
 */

// --- CONFIGURATION CONSTANTS ---
// External libraries loaded via CDN to keep the Framer component self-contained.
const MQTT_SCRIPT = "https://unpkg.com/mqtt@4.3.7/dist/mqtt.min.js"
const PEER_SCRIPT = "https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js"

// Signaling server configuration
const MQTT_SERVER = "wss://broker.emqx.io:8084/mqtt"
const TOPIC_LOBBY = "framer-hybrid-lobby-v1"

// --- INTERFACES ---
interface Props {
    geminiApiKey: string
    systemPrompt: string
    accentColor: string
}

// --- HELPER COMPONENT: CHAT INPUT BAR ---
interface ChatInputProps {
    value: string
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
    onSend: () => void
    onEndCall: () => void
    placeholder?: string
}

function ChatInput({ value, onChange, onSend, onEndCall, placeholder = "Ask anything" }: ChatInputProps) {
    const textareaRef = React.useRef<HTMLTextAreaElement>(null)

    // Auto-resize logic to mimic Gemini's behavior
    React.useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = "24px" // Reset to calculate correct scrollHeight
            const scrollHeight = textareaRef.current.scrollHeight
            // Expand up to ~148px (approx 6 lines)
            textareaRef.current.style.height = Math.min(scrollHeight, 148) + "px"
        }
    }, [value])

    return (
        <div data-layer="flexbox" className="Flexbox" style={{width: '100%', maxWidth: 728, position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', paddingBottom: 24}}>
          <div data-layer="overlay" className="Overlay" style={{width: "100%", padding: "24px 0", background: 'linear-gradient(180deg, rgba(33, 33, 33, 0) 0%, #212121 35%)', justifyContent: 'center', alignItems: 'flex-end', gap: 10, display: 'flex'}}>
            
            {/* INPUT BOX */}
            <div data-layer="input-box" className="InputBox" style={{flex: '1 1 0', minHeight: 56, maxHeight: 384, padding: 10, background: '#303030', overflow: 'hidden', borderRadius: 28, justifyContent: 'flex-end', alignItems: 'flex-end', gap: 4, display: 'flex', pointerEvents: "auto"}}>
              
              {/* UPLOAD ICON */}
              <div data-svg-wrapper data-layer="upload-button" className="UploadButton" style={{cursor: "pointer", opacity: 0.5}}>
                <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
                <g opacity="0.5">
                <path d="M17.3039 24.8039V18.6961H11.1961C10.8117 18.6961 10.5 18.3845 10.5 18C10.5 17.6156 10.8117 17.3039 11.1961 17.3039H17.3039V11.1961C17.3039 10.8117 17.6156 10.5 18 10.5C18.3845 10.5 18.6961 10.8117 18.6961 11.1961V17.3039H24.8039L24.944 17.3182C25.2612 17.383 25.5 17.6636 25.5 18C25.5 18.3364 25.2612 18.617 24.944 18.6819L24.8039 18.6961H18.6961V24.8039C18.6961 25.1884 18.3845 25.5 18 25.5C17.6156 25.5 17.3039 25.1884 17.3039 24.8039Z" fill="white" fillOpacity="0.95"/>
                </g>
                </svg>
              </div>

              {/* TEXT INPUT */}
              <div data-layer="textarea-wrapper" className="TextAreaWrapper" style={{flex: '1 1 0', alignSelf: 'stretch', paddingTop: 6, paddingBottom: 6, justifyContent: 'flex-start', alignItems: 'center', gap: 18, display: 'flex'}}>
                <textarea
                    ref={textareaRef}
                    value={value}
                    onChange={onChange}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault()
                            onSend()
                        }
                    }}
                    placeholder={placeholder}
                    className="ChatTextInput" 
                    style={{
                        flex: '1 1 0', 
                        color: 'white', 
                        fontSize: 16, 
                        fontFamily: 'Inter', 
                        fontWeight: '400', 
                        lineHeight: '24px', 
                        background: 'transparent', 
                        border: 'none', 
                        outline: 'none', 
                        resize: 'none',
                        height: 24,
                        padding: 0, 
                        margin: 0
                    }}
                />
              </div>

              {/* SEND BUTTON */}
              <div data-svg-wrapper data-layer="send-button" className="SendButton" onClick={onSend} style={{cursor: "pointer", opacity: value.trim() ? 1 : 0.5}}>
                <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect width="36" height="36" rx="18" fill="white" fillOpacity="0.95"/>
                <path fillRule="evenodd" clipRule="evenodd" d="M14.5611 18.1299L16.8709 15.8202V23.3716C16.8709 23.9948 17.3762 24.5 17.9994 24.5C18.6226 24.5 19.1278 23.9948 19.1278 23.3716V15.8202L21.4375 18.1299C21.8782 18.5706 22.5927 18.5706 23.0334 18.1299C23.4741 17.6893 23.4741 16.9748 23.0334 16.5341L17.9994 11.5L12.9653 16.5341C12.5246 16.9748 12.5246 17.6893 12.9653 18.1299C13.406 18.5706 14.1204 18.5706 14.5611 18.1299Z" fill="black" fillOpacity="0.95"/>
                </svg>
              </div>
            </div>

            {/* END CALL BUTTON */}
            <div data-svg-wrapper data-layer="end call button." className="EndCallButton" onClick={onEndCall} style={{cursor: "pointer", flexShrink: 0, pointerEvents: "auto"}}>
              <svg width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="56" height="56" rx="28" fill="#EC1313"/>
              <path fillRule="evenodd" clipRule="evenodd" d="M27.6781 23.1106C31.1352 23.1117 34.6939 24.184 37.0687 26.1868L37.2953 26.3831L37.4672 26.5559C37.8472 26.9798 38.0864 27.5521 38.2162 28.1282C38.3671 28.798 38.3876 29.545 38.266 30.2366C38.1456 30.9209 37.8751 31.6084 37.392 32.1018C36.8843 32.6202 36.1796 32.8814 35.3324 32.7366L35.3314 32.7356C34.7119 32.6292 33.7063 32.5366 32.9115 32.2229C32.4959 32.0588 32.0808 31.8166 31.765 31.4377C31.4408 31.0486 31.2549 30.5556 31.2396 29.9592C31.2272 29.4751 30.9307 29.0591 30.3197 28.7356C29.7031 28.4093 28.8466 28.2304 27.9603 28.2336C27.0733 28.237 26.2287 28.422 25.6342 28.7493C25.0485 29.0717 24.7823 29.4778 24.7943 29.9514C24.8084 30.5083 24.6539 30.9782 24.3656 31.3586C24.0858 31.7277 23.7078 31.9759 23.3305 32.1526C22.9532 32.3291 22.5429 32.4491 22.1683 32.5442C21.9604 32.597 21.7847 32.6378 21.6205 32.676L21.139 32.7942C20.3334 33.0112 19.6156 32.845 19.0492 32.4211C18.5046 32.0135 18.1365 31.398 17.9183 30.7571C17.6986 30.1113 17.6138 29.3921 17.6723 28.7209C17.7301 28.0568 17.9338 27.384 18.348 26.8792L18.5541 26.637C20.729 24.1805 24.2238 23.1097 27.6781 23.1106ZM27.6781 24.3098C24.3209 24.3088 21.1226 25.3884 19.2758 27.6399C19.064 27.898 18.9123 28.3117 18.8676 28.8254C18.8235 29.332 18.8885 29.8837 19.0541 30.3704C19.2213 30.8617 19.4748 31.2407 19.768 31.4602C20.0395 31.6634 20.3774 31.7569 20.8265 31.636C21.1275 31.555 21.5633 31.4598 21.8734 31.3811C22.2251 31.2918 22.548 31.1937 22.8217 31.0657C23.0951 30.9376 23.2877 30.7948 23.4096 30.634C23.5229 30.4845 23.6018 30.2847 23.5941 29.9817C23.5671 28.911 24.2272 28.1544 25.0551 27.6985C25.8742 27.2475 26.9315 27.0383 27.9555 27.0344C28.9802 27.0306 30.0448 27.2323 30.8812 27.675C31.7231 28.1207 32.4126 28.8627 32.4398 29.929C32.4488 30.2794 32.5506 30.5056 32.6869 30.6692C32.8315 30.8427 33.0507 30.9874 33.3529 31.1067C33.994 31.3596 34.761 31.4201 35.5346 31.553L35.6996 31.5735C36.0695 31.5975 36.3313 31.4695 36.5346 31.262C36.7913 30.9997 36.9883 30.5694 37.0834 30.0286C37.1773 29.4946 37.1616 28.9078 37.0453 28.3918C36.9266 27.8653 36.7198 27.4804 36.4935 27.2766L36.2933 27.1018C34.1864 25.3265 30.9279 24.3108 27.6781 24.3098Z" fill="white" fillOpacity="0.95"/>
              </svg>
            </div>

          </div>
        </div>
    )
}

/**
 * OmegleMentorshipUI
 * Main component handling video streaming, real-time signaling, and AI-assisted chat.
 */
export default function OmegleMentorshipUI(props: Props) {
    const { geminiApiKey, systemPrompt, accentColor } = props

    // --- STATE: WEBRTC & CONNECTIVITY ---
    // status: tracks the lifecycle of the connection (idle -> searching -> connected)
    const [status, setStatus] = React.useState("idle")
    const [ready, setReady] = React.useState(false) // Tracks if external scripts are loaded
    
    // --- REFS: DOM & PERSISTENT OBJECTS ---
    const localVideoRef = React.useRef<HTMLVideoElement>(null)
    const remoteVideoRef = React.useRef<HTMLVideoElement>(null)
    const localStreamRef = React.useRef<MediaStream | null>(null)
    const mqttClient = React.useRef<any>(null)
    const peerInstance = React.useRef<any>(null)
    const activeCall = React.useRef<any>(null)
    
    // Unique session ID for the user
    const myId = React.useRef("user_" + Math.random().toString(36).substr(2, 6))

    // --- STATE: AI CHAT (GEMINI) ---
    const [messages, setMessages] = React.useState<{ role: string; text: string }[]>([])
    const [inputText, setInputText] = React.useState("")
    const [isLoading, setIsLoading] = React.useState(false)

    // --- STATE: RESPONSIVE UI ---
    const [chatHeight, setChatHeight] = React.useState(300) // Height of the chat drawer
    const [containerSize, setContainerSize] = React.useState({ width: 0, height: 0 })
    const isDragging = React.useRef(false)
    const dragStartY = React.useRef(0)
    const dragStartHeight = React.useRef(0)
    const containerRef = React.useRef<HTMLDivElement>(null)
    const rafRef = React.useRef<number | null>(null)

    // Helper for standardized console logging
    const log = (msg: string) => {
        console.log(`[Curastem Mentorship] ${msg}`)
    }

    // --- EFFECT: RESPONSIVE LAYOUT ENGINE ---
    // Uses ResizeObserver to track container dimensions for aspect-ratio calculations.
    React.useLayoutEffect(() => {
        if (!containerRef.current) return
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setContainerSize({
                    width: entry.contentRect.width,
                    height: entry.contentRect.height
                })
            }
        })
        observer.observe(containerRef.current)
        return () => observer.disconnect()
    }, [])

    // --- EFFECT: INITIALIZATION ---
    // Loads required external dependencies and handles component teardown.
    React.useEffect(() => {
        const loadDependencies = async () => {
            // @ts-ignore - window.mqtt and window.Peer are added via script tags
            if (!window.mqtt || !window.Peer) {
                await loadScript(MQTT_SCRIPT)
                await loadScript(PEER_SCRIPT)
            }
            setReady(true)
            log("System initialized and ready.")
        }
        loadDependencies()
        return () => cleanup()
    }, [])

    /**
     * Dynamically injects a script tag into the document head.
     */
    const loadScript = (src: string) => {
        return new Promise((resolve) => {
            const s = document.createElement("script")
            s.src = src
            s.onload = resolve
            document.body.appendChild(s)
        })
    }

    /**
     * Resets all connections and stops media tracks.
     */
    const cleanup = () => {
        if (localStreamRef.current)
            localStreamRef.current.getTracks().forEach((t) => t.stop())
        if (activeCall.current) activeCall.current.close()
        if (peerInstance.current) peerInstance.current.destroy()
        if (mqttClient.current) mqttClient.current.end()
        setStatus("idle")
    }

    // --- WEBRTC CORE LOGIC ---

    /**
     * Initializes the user's camera/microphone and starts the PeerJS session.
     */
    const startChat = async () => {
        setStatus("searching")
        log("Requesting media permissions...")

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true,
            })
            localStreamRef.current = stream
            if (localVideoRef.current) {
                localVideoRef.current.srcObject = stream
                localVideoRef.current.muted = true
            }

            initPeerJS()
        } catch (err: any) {
            log(`Media Error: ${err.message}`)
            setStatus("idle")
        }
    }

    /**
     * Initializes PeerJS for P2P video communication.
     */
    const initPeerJS = () => {
        log("Establishing PeerJS connection...")
        // @ts-ignore
        const peer = new window.Peer(myId.current, {
            config: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] },
        })
        peerInstance.current = peer

        peer.on("open", (id: string) => {
            log(`P2P Identity assigned: ${id}`)
            initMQTT() // Start looking for partners after P2P is ready
        })

        peer.on("call", (call: any) => {
            if (status === "connected") return
            log("Incoming call detected. Auto-answering...")
            call.answer(localStreamRef.current)
            handleCall(call)
        })

        peer.on("error", (e: any) => log(`P2P Error: ${e.type}`))
    }

    /**
     * Configures the active P2P call and handles media streams.
     */
    const handleCall = (call: any) => {
        activeCall.current = call
        setStatus("connected")
        if (mqttClient.current) mqttClient.current.end() // Stop signaling once connected

        call.on("stream", (remoteStream: any) => {
            log("Remote stream received. Synchronizing video...")
            if (remoteVideoRef.current)
                remoteVideoRef.current.srcObject = remoteStream
        })

        call.on("close", () => {
            log("Session terminated by remote peer.")
            cleanup()
        })
    }

    /**
     * Initializes MQTT signaling for the matchmaking lobby.
     */
    const initMQTT = () => {
        log("Connecting to matchmaking lobby...")
        // @ts-ignore
        const client = window.mqtt.connect(MQTT_SERVER)
        mqttClient.current = client

        client.on("connect", () => {
            log("Connected to lobby. Advertising availability...")
            client.subscribe(TOPIC_LOBBY)

            // Periodic heartbeat to broadcast presence to other users
            const heartbeat = setInterval(() => {
                if (status === "connected" || !client.connected) {
                    clearInterval(heartbeat)
                    return
                }
                client.publish(
                    TOPIC_LOBBY,
                    JSON.stringify({ id: myId.current })
                )
            }, 2000)
        })

        client.on("message", (topic: string, msg: any) => {
            if (status === "connected") return

            const data = JSON.parse(msg.toString())
            if (data.id === myId.current) return

            // Simple deterministic handshake: user with lexicographically larger ID initiates the call
            if (myId.current > data.id) {
                log(`Handshaking with peer: ${data.id}`)
                const call = peerInstance.current.call(
                    data.id,
                    localStreamRef.current
                )
                handleCall(call)
            } else {
                log(`Waiting for handshake from peer: ${data.id}`)
            }
        })
    }

    // --- AI CHAT (GEMINI) LOGIC ---

    /**
     * Handles message delivery to the Google Gemini API.
     */
    const handleSendMessage = async () => {
        if (!inputText.trim()) return
        if (!geminiApiKey) {
            setMessages(prev => [...prev, { role: "model", text: "Please provide a Gemini API Key in the properties panel." }])
            return
        }

        const userMsg = { role: "user", text: inputText }
        setMessages(prev => [...prev, userMsg])
        setInputText("")
        setIsLoading(true)

        try {
            // Construct payload with system prompt and conversation history
            const contents = [
                { role: "user", parts: [{ text: systemPrompt }] },
                ...messages.map(m => ({
                    role: m.role === "user" ? "user" : "model",
                    parts: [{ text: m.text }]
                })),
                { role: "user", parts: [{ text: userMsg.text }] }
            ]

            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${geminiApiKey}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ contents })
                }
            )

            const data = await response.json()
            if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
                const aiText = data.candidates[0].content.parts[0].text
                setMessages(prev => [...prev, { role: "model", text: aiText }])
            } else {
                setMessages(prev => [...prev, { role: "model", text: "Error: No response from Gemini." }])
            }
        } catch (error) {
            setMessages(prev => [...prev, { role: "model", text: "Error connecting to Gemini." }])
        } finally {
            setIsLoading(false)
        }
    }

    // --- DRAG-TO-RESIZE LOGIC ---

    const handlePointerDown = (e: React.PointerEvent) => {
        e.preventDefault()
        isDragging.current = true
        dragStartY.current = e.clientY
        dragStartHeight.current = chatHeight
        
        window.addEventListener("pointermove", handlePointerMove)
        window.addEventListener("pointerup", handlePointerUp)
    }

    const handlePointerMove = (e: PointerEvent) => {
        if (!isDragging.current) return
        e.preventDefault()

        // Batch updates into animation frames for 60fps performance
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        
        rafRef.current = requestAnimationFrame(() => {
            const deltaY = dragStartY.current - e.clientY
            const newHeight = dragStartHeight.current + deltaY
            
            const containerHeight = containerRef.current?.clientHeight || window.innerHeight
            const minHeight = 100 
            const maxHeight = containerHeight - 100 // Maintain visibility for the video area

            setChatHeight(Math.max(minHeight, Math.min(newHeight, maxHeight)))
        })
    }

    const handlePointerUp = () => {
        isDragging.current = false
        if (rafRef.current) {
            cancelAnimationFrame(rafRef.current)
            rafRef.current = null
        }
        window.removeEventListener("pointermove", handlePointerMove)
        window.removeEventListener("pointerup", handlePointerUp)
    }

    // --- UI DIMENSION CALCULATIONS ---
    const hasMessages = messages.length > 0
    const currentChatHeight = hasMessages ? chatHeight : 0

    // Calculates the ideal dimensions for the video containers while preserving aspect ratio.
    const videoSectionHeight = containerSize.height - currentChatHeight - (hasMessages ? 40 : 120)
    const availableWidthPerVideo = (containerSize.width - 48) / 2
    const targetRatio = 1.55

    const widthByHeight = videoSectionHeight * targetRatio
    const heightByWidth = availableWidthPerVideo / targetRatio

    let finalWidth = 0
    let finalHeight = 0
    
    // Choose the bounding dimension to prevent overflow and maintain ratio
    if (containerSize.width > 0 && containerSize.height > 0) {
        if (widthByHeight <= availableWidthPerVideo) {
             finalHeight = videoSectionHeight
             finalWidth = widthByHeight
        } else {
             finalWidth = availableWidthPerVideo
             finalHeight = heightByWidth
        }
    }

    return (
        <div
            ref={containerRef}
            style={{
                width: "100%",
                height: "100%",
                background: "#212121",
                color: "white",
                fontFamily: "Inter, sans-serif",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                position: "relative"
            }}
        >
            {/* 1. VIDEO RENDERING LAYER */}
            <div
                style={{
                    flex: "1 1 0",
                    width: "100%",
                    display: "flex",
                    gap: 16,
                    padding: 16,
                    paddingBottom: hasMessages ? 16 : 100,
                    alignItems: "center", 
                    justifyContent: "center",
                    position: "relative",
                    minHeight: 0,
                    flexWrap: "nowrap",
                    transition: "padding-bottom 0.3s ease",
                    overflow: "hidden"
                }}
            >
                {/* PARTNER VIDEO CONTAINER */}
                <div
                    style={{
                        width: finalWidth,
                        height: finalHeight,
                        borderRadius: 28,
                        background: "#2E2E2E",
                        overflow: "hidden",
                        position: "relative",
                        flexShrink: 0,
                    }}
                >
                    {status === "connected" ? (
                        <video
                            ref={remoteVideoRef}
                            autoPlay
                            playsInline
                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                    ) : (
                        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#666" }}>
                            {status === "searching" ? "Searching for mentor..." : "Ready to connect"}
                        </div>
                    )}
                </div>

                {/* LOCAL USER VIDEO CONTAINER */}
                <div
                    style={{
                        width: finalWidth,
                        height: finalHeight,
                        borderRadius: 28,
                        background: "#2E2E2E",
                        overflow: "hidden",
                        position: "relative",
                        flexShrink: 0,
                    }}
                >
                    <video
                        ref={localVideoRef}
                        autoPlay
                        muted
                        playsInline
                        style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }}
                    />
                    {status === "idle" && (
                        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <button
                                onClick={startChat}
                                disabled={!ready}
                                style={{
                                    padding: "12px 24px",
                                    borderRadius: 99,
                                    border: "none",
                                    background: accentColor,
                                    color: "white",
                                    fontWeight: "bold",
                                    cursor: ready ? "pointer" : "wait",
                                    boxShadow: "0 4px 12px rgba(0,0,0,0.3)"
                                }}
                            >
                                {ready ? "Start Chat" : "Loading System..."}
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* 2. DRAG HANDLE (Chat Drawer Control) */}
            {hasMessages && (
                <div
                    onPointerDown={handlePointerDown}
                    style={{
                        height: 24,
                        width: "100%",
                        maxWidth: 728,
                        margin: "0 auto",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "ns-resize",
                        flexShrink: 0,
                        touchAction: "none",
                        zIndex: 25,
                    }}
                >
                    <div
                        style={{
                            width: 32,
                            height: 4,
                            borderRadius: 2,
                            background: "rgba(255,255,255,0.2)"
                        }}
                    />
                </div>
            )}

            {/* 3. AI CHAT HISTORY LAYER */}
            <div 
                style={{
                    height: currentChatHeight,
                    width: "100%",
                    maxWidth: 728,
                    margin: "0 auto",
                    position: "relative",
                    display: hasMessages ? "flex" : "none",
                    flexDirection: "column",
                }}
            >
                <div
                    style={{
                        flex: 1,
                        width: "100%",
                        padding: "0 24px",
                        paddingBottom: 90,
                        overflowY: "auto",
                        display: "flex",
                        flexDirection: "column",
                        gap: 16,
                    }}
                >
                    {messages.map((msg, idx) => (
                         <div key={idx} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
                             <div style={{ 
                                 maxWidth: "80%", 
                                 padding: "10px 16px", 
                                 borderRadius: 20,
                                 background: msg.role === "user" ? accentColor : "rgba(255, 255, 255, 0.08)",
                                 color: "rgba(255,255,255,0.95)",
                                 lineHeight: 1.5,
                                 fontSize: 14
                             }}>
                                {msg.text}
                             </div>
                         </div>
                    ))}
                    {isLoading && <div style={{ opacity: 0.5, fontSize: 12, paddingLeft: 8 }}>Mentor assistant is thinking...</div>}
                </div>

                {/* 4. CHAT INPUT INTERFACE */}
                <div
                    style={{
                        position: "absolute",
                        bottom: 0,
                        left: 0,
                        right: 0,
                        width: "100%",
                        display: "flex",
                        justifyContent: "center",
                        zIndex: 20,
                        pointerEvents: "none", // Let clicks pass through outside the input
                    }}
                >
                    <ChatInput 
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        onSend={handleSendMessage}
                        onEndCall={cleanup}
                        placeholder="Ask anything"
                    />
                </div>
            </div>

            {/* INITIAL STATE INPUT (Visible when history is empty) */}
            {!hasMessages && (
                <div
                    style={{
                        position: "absolute",
                        bottom: 0,
                        left: 0,
                        right: 0,
                        width: "100%",
                        display: "flex",
                        justifyContent: "center",
                        zIndex: 20,
                        pointerEvents: "none",
                    }}
                >
                    <ChatInput 
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        onSend={handleSendMessage}
                        onEndCall={cleanup}
                        placeholder="Ask anything"
                    />
                </div>
            )}

        </div>
    )
}

// --- FRAMER PROPERTY CONTROLS ---
addPropertyControls(OmegleMentorshipUI, {
    geminiApiKey: {
        type: ControlType.String,
        title: "Gemini API Key",
        description: "Obtain your API key from Google AI Studio.",
        defaultValue: "",
    },
    systemPrompt: {
        type: ControlType.String,
        title: "System Prompt",
        defaultValue: "You are a helpful mentor assistant from Curastem.",
        displayTextArea: true,
    },
    accentColor: {
        type: ControlType.Color,
        title: "Accent Color",
        defaultValue: "#0099FF",
    },
})
