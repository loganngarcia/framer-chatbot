import * as React from "react"
import {
    useState,
    useEffect,
    useRef,
    useCallback,
    startTransition,
} from "react"
import { addPropertyControls, ControlType } from "framer"

/**
 * @framerIntrinsicWidth 800
 * @framerIntrinsicHeight 400
 * @framerSupportedLayoutWidth fixed
 * @framerSupportedLayoutHeight fixed
 */
export default function BallJumpGame(props) {
    const {
        backgroundColor,
        foregroundColor,
        scoreColor,
        gameSpeed,
        jumpForce,
        gravity,
        scorePosition,
        scorePadding,
        title,
        titleFont,
        instructionFont,
        scoreFont,
        highScoreFont,
        ballSize,
        startInstructionText,
        playAgainTitle,
        playAgainInstructionText,
    } = props

    // Game State
    const [score, setScore] = useState(0)
    const [highScore, setHighScore] = useState(0)
    const [gameState, setGameState] = useState("waiting")
    const [tick, setTick] = useState(0)
    const [isBlinking, setIsBlinking] = useState(false)

    // Blink Effect
    useEffect(() => {
        let timeoutId
        const blinkLoop = () => {
            const nextBlink = 2000 + Math.random() * 2000
            timeoutId = setTimeout(() => {
                startTransition(() => {
                    setIsBlinking(true)
                })
                timeoutId = setTimeout(() => {
                    startTransition(() => {
                        setIsBlinking(false)
                    })
                    blinkLoop()
                }, 150)
            }, nextBlink)
        }
        blinkLoop()
        return () => clearTimeout(timeoutId)
    }, [])

    // Refs for game logic
    const requestRef = useRef()
    const lastTimeRef = useRef()
    const containerRef = useRef(null)
    const isLoopRunning = useRef(false)

    const stateRef = useRef({
        ballY: 0,
        ballVelocity: 0,
        obstacles: [],
        score: 0,
        gameSpeed: gameSpeed,
        isGameOver: false,
        isPlaying: false,
    })

    // Constants
    const BALL_X = 50
    const GROUND_HEIGHT = 50

    // Reset Game
    const resetGame = useCallback(() => {
        stateRef.current = {
            ballY: 0,
            ballVelocity: 0,
            obstacles: [],
            score: 0,
            gameSpeed: gameSpeed,
            isGameOver: false,
            isPlaying: true,
        }
        lastTimeRef.current = performance.now()

        startTransition(() => {
            setScore(0)
            setGameState("playing")
        })
    }, [gameSpeed])

    // Jump Action
    const jump = useCallback(() => {
        const state = stateRef.current
        if (state.isGameOver) {
            resetGame()
        } else if (!state.isPlaying) {
            resetGame()
        } else {
            if (state.ballY <= 0) {
                state.ballVelocity = -jumpForce
            }
        }
    }, [jumpForce, resetGame])

    // Game Loop
    const update = useCallback(
        (time) => {
            if (!containerRef.current) return

            // Calculate Delta Time
            if (!lastTimeRef.current) lastTimeRef.current = time
            const deltaTime = time - lastTimeRef.current
            lastTimeRef.current = time

            const timeScale = Math.min(deltaTime / 16.67, 4)

            const state = stateRef.current
            if (!state.isPlaying || state.isGameOver) {
                isLoopRunning.current = false
                return
            }

            const containerWidth = containerRef.current.clientWidth

            // Physics
            state.ballVelocity += gravity * timeScale
            state.ballY -= state.ballVelocity * timeScale

            // Ground Collision
            if (state.ballY <= 0) {
                state.ballY = 0
                state.ballVelocity = 0
            }

            // Obstacle Spawning
            const lastObstacle = state.obstacles[state.obstacles.length - 1]
            const minGap = 300 + Math.random() * 200

            if (
                !lastObstacle ||
                containerWidth - (lastObstacle.x + lastObstacle.width) > minGap
            ) {
                if (Math.random() > 0.5) {
                    state.obstacles.push({
                        x: containerWidth,
                        width: 30 + Math.random() * 30,
                        height: 40 + Math.random() * 40,
                    })
                }
            }

            // Update Obstacles
            state.obstacles.forEach((obs) => {
                obs.x -= state.gameSpeed * timeScale
            })

            // Remove off-screen obstacles
            state.obstacles = state.obstacles.filter(
                (obs) => obs.x + obs.width > 0
            )

            // Collision Detection
            const hitBoxPadding = 6
            const ballLeft = BALL_X + hitBoxPadding
            const ballRight = BALL_X + ballSize - hitBoxPadding

            for (const obs of state.obstacles) {
                const obsLeft = obs.x
                const obsRight = obs.x + obs.width

                if (
                    ballRight > obsLeft &&
                    ballLeft < obsRight &&
                    state.ballY < obs.height
                ) {
                    state.isGameOver = true
                    state.isPlaying = false
                    isLoopRunning.current = false
                    startTransition(() => {
                        setGameState("gameover")
                        setHighScore((prev) =>
                            Math.max(prev, Math.floor(state.score))
                        )
                    })
                    return
                }
            }

            // Score Update
            state.score += 0.1 * timeScale

            startTransition(() => {
                setScore(Math.floor(state.score))
                setTick((prev) => prev + 1)
            })

            requestRef.current = requestAnimationFrame(update)
        },
        [gravity, ballSize]
    )

    // Start/Stop Loop Management
    useEffect(() => {
        if (requestRef.current) cancelAnimationFrame(requestRef.current)

        lastTimeRef.current = performance.now()
        isLoopRunning.current = true
        requestRef.current = requestAnimationFrame(update)

        return () => {
            isLoopRunning.current = false
            if (requestRef.current) cancelAnimationFrame(requestRef.current)
        }
    }, [update, gameState])

    // Input Listeners
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.code === "Space" || e.code === "ArrowUp") {
                e.preventDefault()
                jump()
            }
        }
        window.addEventListener("keydown", handleKeyDown)
        return () => window.removeEventListener("keydown", handleKeyDown)
    }, [jump])

    // Styles
    const containerStyle = {
        width: "100%",
        height: "100%",
        backgroundColor: backgroundColor,
        position: "relative",
        overflow: "hidden",
        cursor: "pointer",
        userSelect: "none",
        fontFamily: "Inter, sans-serif",
    }

    const groundStyle = {
        position: "absolute",
        bottom: GROUND_HEIGHT,
        left: 0,
        right: 0,
        height: 2,
        backgroundColor: foregroundColor,
        opacity: 0.5,
    }

    const ballStyle = {
        position: "absolute",
        left: BALL_X,
        bottom: GROUND_HEIGHT + stateRef.current.ballY + 2,
        width: ballSize,
        height: ballSize,
        transition: "none",
        zIndex: 10,
    }

    const scoreStyle = {
        position: "absolute",
        top: scorePadding,
        color: scoreColor,
        ...scoreFont,
        ...(scorePosition === "left"
            ? { left: scorePadding, textAlign: "left" }
            : scorePosition === "right"
              ? { right: scorePadding, textAlign: "right" }
              : {
                    left: "50%",
                    transform: "translateX(-50%)",
                    textAlign: "center",
                }),
        zIndex: 20,
    }

    const centerTextStyle = {
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        color: foregroundColor,
        textAlign: "center",
        pointerEvents: "none",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        zIndex: 20,
    }

    return (
        <div
            ref={containerRef}
            style={containerStyle}
            onMouseDown={jump}
            onTouchStart={jump}
        >
            {/* Score */}
            <div style={scoreStyle}>
                {Math.floor(score).toString().padStart(5, "0")}
                <div style={{ opacity: 0.6, ...highScoreFont }}>
                    HI {highScore.toString().padStart(5, "0")}
                </div>
            </div>

            {/* Game Area */}
            <div style={groundStyle} />

            {/* Character */}
            <div style={ballStyle}>
                <div
                    style={{
                        width: "100%",
                        height: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        pointerEvents: "none",
                    }}
                >
                    <div
                        style={{
                            width: 187.29,
                            height: 191.04,
                            transform: `scale(${ballSize / 187.29})`,
                            transformOrigin: "center center",
                            flexShrink: 0,
                        }}
                    >
                        {/* New Character SVG Logic */}
                        <div
                            data-layer="thinking"
                            className="Thinking"
                            style={{
                                width: 187.29,
                                height: 191.04,
                                position: "relative",
                            }}
                        >
                            <div
                                data-layer="white"
                                className="White"
                                style={{
                                    width: 187.29,
                                    height: 191.04,
                                    left: 0,
                                    top: 0,
                                    position: "absolute",
                                    background: "#F5F5F5",
                                    borderRadius: 9999,
                                }}
                            />
                            <div
                                data-layer="blue blur"
                                className="BlueBlur"
                                style={{
                                    width: 143.58,
                                    height: 149.83,
                                    left: 21.84,
                                    top: 19.31,
                                    position: "absolute",
                                    background:
                                        "linear-gradient(180deg, #0099FF 0%, #F5F5F5 100%)",
                                    borderRadius: 9999,
                                    filter: "blur(14.98px)",
                                }}
                            />
                            <div
                                data-svg-wrapper
                                data-layer="eye 1"
                                className="Eye1"
                                style={{
                                    left: 59.52,
                                    top: 48.70,
                                    position: "absolute",
                                }}
                            >
                                <svg
                                    width="36"
                                    height="44"
                                    viewBox="0 0 36 44"
                                    fill="none"
                                    xmlns="http://www.w3.org/2000/svg"
                                >
                                    <ellipse
                                        cx="17.6474"
                                        cy="21.6267"
                                        rx="17.4348"
                                        ry={isBlinking ? 4.5 : 21.7935}
                                        transform={`rotate(${
                                            isBlinking ? -2 : -12
                                        } 17.6474 21.6267)`}
                                        fill="#F5F5F5"
                                        fillOpacity="0.85"
                                    />
                                </svg>
                            </div>
                            <div
                                data-svg-wrapper
                                data-layer="eye 2"
                                className="Eye2"
                                style={{
                                    left: 106.01,
                                    top: 34.03,
                                    position: "absolute",
                                }}
                            >
                                <svg
                                    width="36"
                                    height="44"
                                    viewBox="0 0 36 44"
                                    fill="none"
                                    xmlns="http://www.w3.org/2000/svg"
                                >
                                    <ellipse
                                        cx="17.6474"
                                        cy="21.6267"
                                        rx="17.4348"
                                        ry={isBlinking ? 4.5 : 21.7935}
                                        transform={`rotate(${
                                            isBlinking ? -2 : -12
                                        } 17.6474 21.6267)`}
                                        fill="#F5F5F5"
                                        fillOpacity="0.85"
                                    />
                                </svg>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Obstacles */}
            {stateRef.current.obstacles.map((obs, i) => (
                <div
                    key={i}
                    style={{
                        position: "absolute",
                        left: obs.x,
                        bottom: GROUND_HEIGHT,
                        width: obs.width,
                        height: obs.height,
                        backgroundColor: foregroundColor,
                    }}
                />
            ))}

            {/* UI Overlays */}
            {gameState === "waiting" && (
                <div style={centerTextStyle}>
                    <h1 style={{ margin: 0, ...titleFont }}>{title}</h1>
                    <p style={{ margin: 0, opacity: 1, ...instructionFont }}>
                        {startInstructionText}
                    </p>
                </div>
            )}

            {gameState === "gameover" && (
                <div style={centerTextStyle}>
                    <h1 style={{ margin: 0, ...titleFont }}>{playAgainTitle}</h1>
                    <p style={{ margin: 0, opacity: 1, ...instructionFont }}>
                        {playAgainInstructionText}
                    </p>
                </div>
            )}
        </div>
    )
}

addPropertyControls(BallJumpGame, {
    title: {
        type: ControlType.String,
        title: "Title",
        defaultValue: "BALL JUMP",
    },
    startInstructionText: {
        type: ControlType.String,
        title: "Start Instruction",
        defaultValue: "Click or Space to Start",
    },
    playAgainTitle: {
        type: ControlType.String,
        title: "Play Again Title",
        defaultValue: "PLAY AGAIN",
    },
    playAgainInstructionText: {
        type: ControlType.String,
        title: "Play Again Instruction",
        defaultValue: "Click to Start",
    },
    ballSize: {
        type: ControlType.Number,
        title: "Ball Size",
        defaultValue: 30,
        min: 10,
        max: 100,
        step: 1,
    },
    titleFont: {
        type: ControlType.Font,
        title: "Title Font",
        controls: "extended",
        defaultValue: {
            fontSize: 40,
            variant: "Bold",
            textAlign: "center",
        },
    },
    instructionFont: {
        type: ControlType.Font,
        title: "Instr Font",
        controls: "extended",
        defaultValue: {
            fontSize: 14,
            variant: "Regular",
            textAlign: "center",
        },
    },
    scoreFont: {
        type: ControlType.Font,
        title: "Score Font",
        controls: "extended",
        defaultValue: {
            fontSize: 24,
            variant: "Bold",
            textAlign: "right",
        },
    },
    highScoreFont: {
        type: ControlType.Font,
        title: "HiScore Font",
        controls: "extended",
        defaultValue: {
            fontSize: 12,
            variant: "Regular",
            textAlign: "right",
        },
    },
    scoreColor: {
        type: ControlType.Color,
        title: "Score Color",
        defaultValue: "#FFFFFF",
    },
    backgroundColor: {
        type: ControlType.Color,
        title: "Background",
        defaultValue: "#111111",
    },
    foregroundColor: {
        type: ControlType.Color,
        title: "Foreground",
        defaultValue: "#FFFFFF",
    },
    gameSpeed: {
        type: ControlType.Number,
        title: "Speed",
        defaultValue: 14,
        min: 4,
        max: 20,
        step: 1,
    },
    jumpForce: {
        type: ControlType.Number,
        title: "Jump Force",
        defaultValue: 23,
        min: 5,
        max: 40,
        step: 1,
    },
    gravity: {
        type: ControlType.Number,
        title: "Gravity",
        defaultValue: 2,
        min: 0.1,
        max: 4,
        step: 0.1,
    },
    scorePosition: {
        type: ControlType.Enum,
        title: "Score Pos",
        options: ["left", "center", "right"],
        optionTitles: ["Left", "Center", "Right"],
        defaultValue: "right",
    },
    scorePadding: {
        type: ControlType.Number,
        title: "Score Pad",
        defaultValue: 20,
        min: 0,
        max: 250,
    },
})
