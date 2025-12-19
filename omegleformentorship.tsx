import * as React from "react"
import { addPropertyControls, ControlType } from "framer"

// --- CONFIG ---
const MQTT_SCRIPT = "https://unpkg.com/mqtt@4.3.7/dist/mqtt.min.js"
const PEER_SCRIPT = "https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js"
const MQTT_SERVER = "wss://broker.emqx.io:8084/mqtt"
const TOPIC_LOBBY = "framer-hybrid-lobby-v1"

// --- INTERFACES ---
interface Props {
    geminiApiKey: string
    systemPrompt: string
    accentColor: string
}

// --- COMPONENT ---
export default function OmegleMentorshipUI(props: Props) {
    const { geminiApiKey, systemPrompt, accentColor } = props

    // --- STATE: VIDEO / PEER ---
    const [status, setStatus] = React.useState("idle") // idle, searching, connected
    const [ready, setReady] = React.useState(false)
    const [logs, setLogs] = React.useState<string[]>([])
    
    // REFS
    const localVideoRef = React.useRef<HTMLVideoElement>(null)
    const remoteVideoRef = React.useRef<HTMLVideoElement>(null)
    const localStreamRef = React.useRef<MediaStream | null>(null)
    const mqttClient = React.useRef<any>(null)
    const peerInstance = React.useRef<any>(null)
    const activeCall = React.useRef<any>(null)
    const myId = React.useRef("user_" + Math.random().toString(36).substr(2, 6))

    // --- STATE: CHAT (GEMINI) ---
    const [messages, setMessages] = React.useState<{ role: string; text: string }[]>([])
    const [inputText, setInputText] = React.useState("")
    const [isLoading, setIsLoading] = React.useState(false)

    // --- STATE: UI ---
    const [chatHeight, setChatHeight] = React.useState(300) // Start height in px
    const isDragging = React.useRef(false)
    const dragStartY = React.useRef(0)
    const dragStartHeight = React.useRef(0)
    const containerRef = React.useRef<HTMLDivElement>(null)

    // --- LOGGING ---
    const log = (msg: string) => {
        console.log(`[Omegle] ${msg}`)
    }

    // --- 1. SETUP (Load Scripts) ---
    React.useEffect(() => {
        const load = async () => {
            // @ts-ignore
            if (!window.mqtt || !window.Peer) {
                await loadScript(MQTT_SCRIPT)
                await loadScript(PEER_SCRIPT)
            }
            setReady(true)
            log("System Ready.")
        }
        load()
        return () => cleanup()
    }, [])

    const loadScript = (src: string) => {
        return new Promise((resolve) => {
            const s = document.createElement("script")
            s.src = src
            s.onload = resolve
            document.body.appendChild(s)
        })
    }

    const cleanup = () => {
        if (localStreamRef.current)
            localStreamRef.current.getTracks().forEach((t) => t.stop())
        if (activeCall.current) activeCall.current.close()
        if (peerInstance.current) peerInstance.current.destroy()
        if (mqttClient.current) mqttClient.current.end()
        setStatus("idle")
    }

    // --- 2. START PROCESS ---
    const startChat = async () => {
        setStatus("searching")
        log("Starting Camera...")

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
            log(`Error: ${err.message}`)
            setStatus("idle")
        }
    }

    // --- 3. PEERJS (Video Layer) ---
    const initPeerJS = () => {
        log("Init PeerJS...")
        // @ts-ignore
        const peer = new window.Peer(myId.current, {
            config: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] },
        })
        peerInstance.current = peer

        peer.on("open", (id: string) => {
            log(`My Peer ID: ${id}`)
            initMQTT()
        })

        peer.on("call", (call: any) => {
            if (status === "connected") return
            log("📞 Incoming Call! Answering...")
            call.answer(localStreamRef.current)
            handleCall(call)
        })

        peer.on("error", (e: any) => log(`Peer Error: ${e.type}`))
    }

    const handleCall = (call: any) => {
        activeCall.current = call
        setStatus("connected")
        if (mqttClient.current) mqttClient.current.end()

        call.on("stream", (remoteStream: any) => {
            log("✅ Connected to Partner!")
            if (remoteVideoRef.current)
                remoteVideoRef.current.srcObject = remoteStream
        })

        call.on("close", () => {
            log("Call Ended.")
            cleanup()
        })
    }

    // --- 4. MQTT (Lobby Layer) ---
    const initMQTT = () => {
        log("Connecting to Lobby (EMQX)...")
        // @ts-ignore
        const client = window.mqtt.connect(MQTT_SERVER)
        mqttClient.current = client

        client.on("connect", () => {
            log("Joined Lobby. Broadcasting...")
            client.subscribe(TOPIC_LOBBY)

            const interval = setInterval(() => {
                if (status === "connected" || !client.connected) {
                    clearInterval(interval)
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

            if (myId.current > data.id) {
                log(`Found partner ${data.id}. Calling...`)
                const call = peerInstance.current.call(
                    data.id,
                    localStreamRef.current
                )
                handleCall(call)
            } else {
                log(`Found partner ${data.id}. Waiting for them to call...`)
            }
        })
    }

    // --- 5. GEMINI AI CHAT ---
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

    // --- DRAG LOGIC ---
    const handlePointerDown = (e: React.PointerEvent) => {
        e.preventDefault() // Prevent scrolling on touch
        isDragging.current = true
        dragStartY.current = e.clientY
        dragStartHeight.current = chatHeight
        
        // Add global listeners
        window.addEventListener("pointermove", handlePointerMove)
        window.addEventListener("pointerup", handlePointerUp)
    }

    const handlePointerMove = (e: PointerEvent) => {
        if (!isDragging.current) return
        e.preventDefault()

        const deltaY = dragStartY.current - e.clientY // Drag up increases height
        const newHeight = dragStartHeight.current + deltaY
        
        // Constraints
        const containerHeight = containerRef.current?.clientHeight || window.innerHeight
        const minHeight = 100 // Minimum chat height
        const maxHeight = containerHeight - 150 // Keep some video space

        setChatHeight(Math.max(minHeight, Math.min(newHeight, maxHeight)))
    }

    const handlePointerUp = () => {
        isDragging.current = false
        window.removeEventListener("pointermove", handlePointerMove)
        window.removeEventListener("pointerup", handlePointerUp)
    }

    const hasMessages = messages.length > 0
    const currentChatHeight = hasMessages ? chatHeight : 0

    return (
        <div
            ref={containerRef}
            style={{
                width: "100%",
                height: "100%",
                background: "#121212",
                color: "white",
                fontFamily: "Inter, sans-serif",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                position: "relative"
            }}
        >
            {/* 1. TOP SECTION: VIDEOS (FLEX GROWS) */}
            <div
                style={{
                    flex: "1 1 0", // Fills remaining space
                    width: "100%",
                    display: "flex",
                    gap: 16,
                    padding: 16,
                    paddingBottom: hasMessages ? 16 : 100, // Reduced padding when messages are present
                    alignItems: "center", 
                    justifyContent: "center",
                    position: "relative",
                    minHeight: 0,
                    flexWrap: "wrap",
                    transition: "padding-bottom 0.3s ease",
                    overflow: "hidden"
                }}
            >
                {/* PARTNER VIDEO */}
                <div
                    style={{
                        flex: "1 1 0",
                        aspectRatio: "1.55 / 1", 
                        minWidth: 300, 
                        maxWidth: "100%",
                        borderRadius: 28,
                        background: "#222",
                        overflow: "hidden",
                        position: "relative",
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
                            {status === "searching" ? "Searching..." : "Waiting"}
                        </div>
                    )}
                </div>

                {/* USER VIDEO */}
                <div
                    style={{
                        flex: "1 1 0",
                        aspectRatio: "1.55 / 1",
                        minWidth: 300,
                        maxWidth: "100%",
                        borderRadius: 28,
                        background: "#222",
                        overflow: "hidden",
                        position: "relative",
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
                                    cursor: ready ? "pointer" : "wait"
                                }}
                            >
                                {ready ? "Start Chat" : "Loading..."}
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* 2. DRAG HANDLE (VISIBLE ONLY IF MESSAGES EXIST) */}
            {hasMessages && (
                <div
                    onPointerDown={handlePointerDown}
                    style={{
                        height: 24,
                        width: "100%",
                        maxWidth: 728, // Constrained width
                        margin: "0 auto", // Centered
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "ns-resize",
                        flexShrink: 0,
                        touchAction: "none", // Prevent scroll
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

            {/* 3. CHAT AREA CONTAINER (Constrained Max Width) */}
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
                {/* Chat History */}
                <div
                    style={{
                        flex: 1,
                        width: "100%",
                        padding: "0 24px",
                        paddingBottom: 90, // Space for input bar
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
                                 lineHeight: 1.5
                             }}>
                                {msg.text}
                             </div>
                         </div>
                    ))}
                    {isLoading && <div style={{ opacity: 0.5, fontSize: 12 }}>Typing...</div>}
                </div>

                {/* 4. INPUT OVERLAY (Within constrained container) */}
                <div
                    style={{
                        position: "absolute",
                        bottom: 0,
                        left: 0,
                        right: 0,
                        width: "100%",
                        padding: "12px 24px 32px",
                        background: "linear-gradient(to top, #121212 60%, transparent)",
                        display: "flex",
                        alignItems: "flex-end",
                        gap: 12,
                        zIndex: 20,
                        pointerEvents: "auto",
                    }}
                >
                    <div
                        style={{
                            flex: 1,
                            background: "#303030",
                            borderRadius: 28,
                            padding: "10px 16px",
                            display: "flex",
                            alignItems: "center",
                            gap: 12
                        }}
                    >
                        {/* Upload Icon */}
                        <div style={{ opacity: 0.5, cursor: "pointer" }}>
                            <svg width="24" height="24" viewBox="0 0 36 36" fill="white">
                                <path d="M17.3 24.8V18.7H11.2C10.8 18.7 10.5 18.4 10.5 18C10.5 17.6 10.8 17.3 11.2 17.3H17.3V11.2C17.3 10.8 17.6 10.5 18 10.5C18.4 10.5 18.7 10.8 18.7 11.2V17.3H24.8L24.9 17.3C25.3 17.4 25.5 17.7 25.5 18C25.5 18.3 25.3 18.6 24.9 18.7L24.8 18.7H18.7V24.8C18.7 25.2 18.4 25.5 18 25.5C17.6 25.5 17.3 25.2 17.3 24.8Z" />
                            </svg>
                        </div>

                        <input
                            value={inputText}
                            onChange={(e) => setInputText(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                            placeholder="Ask anything..."
                            style={{
                                flex: 1,
                                background: "transparent",
                                border: "none",
                                color: "white",
                                fontSize: 16,
                                outline: "none"
                            }}
                        />
                    </div>

                    {/* Send / End Button */}
                    <div
                        onClick={() => {
                            if (inputText) handleSendMessage()
                            else cleanup()
                        }}
                        style={{
                            width: 48,
                            height: 48,
                            borderRadius: 24,
                            background: "#EC1313",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            flexShrink: 0
                        }}
                    >
                         <svg width="24" height="24" viewBox="0 0 56 56" fill="white">
                             <path fillRule="evenodd" clipRule="evenodd" d="M27.6781 23.1106C31.1352 23.1117 34.6939 24.184 37.0687 26.1868L37.2953 26.3831L37.4672 26.5559C37.8472 26.9798 38.0864 27.5521 38.2162 28.1282C38.3671 28.798 38.3876 29.545 38.266 30.2366C38.1456 30.9209 37.8751 31.6084 37.392 32.1018C36.8843 32.6202 36.1796 32.8814 35.3324 32.7366L35.3314 32.7356C34.7119 32.6292 33.7063 32.5366 32.9115 32.2229C32.4959 32.0588 32.0808 31.8166 31.765 31.4377C31.4408 31.0486 31.2549 30.5556 31.2396 29.9592C31.2272 29.4751 30.9307 29.0591 30.3197 28.7356C29.7031 28.4093 28.8466 28.2304 27.9603 28.2336C27.0733 28.237 26.2287 28.422 25.6342 28.7493C25.0485 29.0717 24.7823 29.4778 24.7943 29.9514C24.8084 30.5083 24.6539 30.9782 24.3656 31.3586C24.0858 31.7277 23.7078 31.9759 23.3305 32.1526C22.9532 32.3291 22.5429 32.4491 22.1683 32.5442C21.9604 32.597 21.7847 32.6378 21.6205 32.676L21.139 32.7942C20.3334 33.0112 19.6156 32.845 19.0492 32.4211C18.5046 32.0135 18.1365 31.398 17.9183 30.7571C17.6986 30.1113 17.6138 29.3921 17.6723 28.7209C17.7301 28.0568 17.9338 27.384 18.348 26.8792L18.5541 26.637C20.729 24.1805 24.2238 23.1097 27.6781 23.1106ZM27.6781 24.3098C24.3209 24.3088 21.1226 25.3884 19.2758 27.6399C19.064 27.898 18.9123 28.3117 18.8676 28.8254C18.8235 29.332 18.8885 29.8837 19.0541 30.3704C19.2213 30.8617 19.4748 31.2407 19.768 31.4602C20.0395 31.6634 20.3774 31.7569 20.8265 31.636C21.1275 31.555 21.5633 31.4598 21.8734 31.3811C22.2251 31.2918 22.548 31.1937 22.8217 31.0657C23.0951 30.9376 23.2877 30.7948 23.4096 30.634C23.5229 30.4845 23.6018 30.2847 23.5941 29.9817C23.5671 28.911 24.2272 28.1544 25.0551 27.6985C25.8742 27.2475 26.9315 27.0383 27.9555 27.0344C28.9802 27.0306 30.0448 27.2323 30.8812 27.675C31.7231 28.1207 32.4126 28.8627 32.4398 29.929C32.4488 30.2794 32.5506 30.5056 32.6869 30.6692C32.8315 30.8427 33.0507 30.9874 33.3529 31.1067C33.994 31.3596 34.761 31.4201 35.5346 31.553L35.6996 31.5735C36.0695 31.5975 36.3313 31.4695 36.5346 31.262C36.7913 30.9997 36.9883 30.5694 37.0834 30.0286C37.1773 29.4946 37.1616 28.9078 37.0453 28.3918C36.9266 27.8653 36.7198 27.4804 36.4935 27.2766L36.2933 27.1018C34.1864 25.3265 30.9279 24.3108 27.6781 24.3098Z" />
                         </svg>
                    </div>
                </div>
            </div>
            
            {/* INPUT OVERLAY (Floating at bottom for initial state if no messages) */}
            {!hasMessages && (
                <div
                    style={{
                        position: "absolute",
                        bottom: 0,
                        left: 0,
                        right: 0,
                        width: "100%",
                        maxWidth: 728,
                        margin: "0 auto",
                        padding: "12px 24px 32px",
                        background: "linear-gradient(to top, #121212 60%, transparent)",
                        display: "flex",
                        alignItems: "flex-end",
                        gap: 12,
                        zIndex: 20,
                        pointerEvents: "auto",
                    }}
                >
                     <div
                        style={{
                            flex: 1,
                            background: "#303030",
                            borderRadius: 28,
                            padding: "10px 16px",
                            display: "flex",
                            alignItems: "center",
                            gap: 12
                        }}
                    >
                        <div style={{ opacity: 0.5, cursor: "pointer" }}>
                            <svg width="24" height="24" viewBox="0 0 36 36" fill="white">
                                <path d="M17.3 24.8V18.7H11.2C10.8 18.7 10.5 18.4 10.5 18C10.5 17.6 10.8 17.3 11.2 17.3H17.3V11.2C17.3 10.8 17.6 10.5 18 10.5C18.4 10.5 18.7 10.8 18.7 11.2V17.3H24.8L24.9 17.3C25.3 17.4 25.5 17.7 25.5 18C25.5 18.3 25.3 18.6 24.9 18.7L24.8 18.7H18.7V24.8C18.7 25.2 18.4 25.5 18 25.5C17.6 25.5 17.3 25.2 17.3 24.8Z" />
                            </svg>
                        </div>
                        <input
                            value={inputText}
                            onChange={(e) => setInputText(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                            placeholder="Ask anything..."
                            style={{
                                flex: 1,
                                background: "transparent",
                                border: "none",
                                color: "white",
                                fontSize: 16,
                                outline: "none"
                            }}
                        />
                    </div>
                     <div
                        onClick={() => {
                            if (inputText) handleSendMessage()
                            else cleanup()
                        }}
                        style={{
                            width: 48,
                            height: 48,
                            borderRadius: 24,
                            background: "#EC1313",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            flexShrink: 0
                        }}
                    >
                         <svg width="24" height="24" viewBox="0 0 56 56" fill="white">
                             <path fillRule="evenodd" clipRule="evenodd" d="M27.6781 23.1106C31.1352 23.1117 34.6939 24.184 37.0687 26.1868L37.2953 26.3831L37.4672 26.5559C37.8472 26.9798 38.0864 27.5521 38.2162 28.1282C38.3671 28.798 38.3876 29.545 38.266 30.2366C38.1456 30.9209 37.8751 31.6084 37.392 32.1018C36.8843 32.6202 36.1796 32.8814 35.3324 32.7366L35.3314 32.7356C34.7119 32.6292 33.7063 32.5366 32.9115 32.2229C32.4959 32.0588 32.0808 31.8166 31.765 31.4377C31.4408 31.0486 31.2549 30.5556 31.2396 29.9592C31.2272 29.4751 30.9307 29.0591 30.3197 28.7356C29.7031 28.4093 28.8466 28.2304 27.9603 28.2336C27.0733 28.237 26.2287 28.422 25.6342 28.7493C25.0485 29.0717 24.7823 29.4778 24.7943 29.9514C24.8084 30.5083 24.6539 30.9782 24.3656 31.3586C24.0858 31.7277 23.7078 31.9759 23.3305 32.1526C22.9532 32.3291 22.5429 32.4491 22.1683 32.5442C21.9604 32.597 21.7847 32.6378 21.6205 32.676L21.139 32.7942C20.3334 33.0112 19.6156 32.845 19.0492 32.4211C18.5046 32.0135 18.1365 31.398 17.9183 30.7571C17.6986 30.1113 17.6138 29.3921 17.6723 28.7209C17.7301 28.0568 17.9338 27.384 18.348 26.8792L18.5541 26.637C20.729 24.1805 24.2238 23.1097 27.6781 23.1106ZM27.6781 24.3098C24.3209 24.3088 21.1226 25.3884 19.2758 27.6399C19.064 27.898 18.9123 28.3117 18.8676 28.8254C18.8235 29.332 18.8885 29.8837 19.0541 30.3704C19.2213 30.8617 19.4748 31.2407 19.768 31.4602C20.0395 31.6634 20.3774 31.7569 20.8265 31.636C21.1275 31.555 21.5633 31.4598 21.8734 31.3811C22.2251 31.2918 22.548 31.1937 22.8217 31.0657C23.0951 30.9376 23.2877 30.7948 23.4096 30.634C23.5229 30.4845 23.6018 30.2847 23.5941 29.9817C23.5671 28.911 24.2272 28.1544 25.0551 27.6985C25.8742 27.2475 26.9315 27.0383 27.9555 27.0344C28.9802 27.0306 30.0448 27.2323 30.8812 27.675C31.7231 28.1207 32.4126 28.8627 32.4398 29.929C32.4488 30.2794 32.5506 30.5056 32.6869 30.6692C32.8315 30.8427 33.0507 30.9874 33.3529 31.1067C33.994 31.3596 34.761 31.4201 35.5346 31.553L35.6996 31.5735C36.0695 31.5975 36.3313 31.4695 36.5346 31.262C36.7913 30.9997 36.9883 30.5694 37.0834 30.0286C37.1773 29.4946 37.1616 28.9078 37.0453 28.3918C36.9266 27.8653 36.7198 27.4804 36.4935 27.2766L36.2933 27.1018C34.1864 25.3265 30.9279 24.3108 27.6781 24.3098Z" />
                         </svg>
                    </div>
                </div>
            )}

        </div>
    )
}

addPropertyControls(OmegleMentorshipUI, {
    geminiApiKey: {
        type: ControlType.String,
        title: "Gemini API Key",
        description: "Get key from Google AI Studio",
        defaultValue: "",
    },
    systemPrompt: {
        type: ControlType.String,
        title: "System Prompt",
        defaultValue: "You are a helpful mentor assistant.",
        displayTextArea: true,
    },
    accentColor: {
        type: ControlType.Color,
        title: "Accent Color",
        defaultValue: "#0EA5E9",
    },
})
