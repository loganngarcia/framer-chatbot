/**
 * Donation Form
 *
 * A high-fidelity recreation of the requested donation form UI.
 * Now integrated with Stripe Payment Links via Property Controls.
 *
 * @framerSupportedLayoutWidth fixed
 * @framerSupportedLayoutHeight auto
 */
import React, { useState, useMemo, type CSSProperties, type ChangeEvent } from "react"
import { addPropertyControls, ControlType } from "framer"
import { motion, AnimatePresence } from "framer-motion"

export default function DonationForm(props) {
    const {
        linkOneTime5,
        linkOneTime25,
        linkOneTime100,
        linkOneTimeOther,
        linkMonthly5,
        linkMonthly25,
        linkMonthly100,
        linkMonthlyOther,
        accentColor,
        backgroundColor,
        inputBackgroundColor,
        textColor,
        subtitleColor,
        placeholderColor,
        containerRadius,
        elementRadius,
        donateButtonRadius,
        font,
        buttonFont,
        titleFont,
        showFeeCoverage = false,
        padding = "16px",
        gap = 24,
    } = props

    const uniqueId = useMemo(
        () => `donation-form-${Math.random().toString(36).substr(2, 9)}`,
        []
    )

    const [frequency, setFrequency] = useState("One-time")
    const [amount, setAmount] = useState("$5")
    const [customAmount, setCustomAmount] = useState("")
    const [selectedMonth, setSelectedMonth] = useState("Month")
    const [selectedDay, setSelectedDay] = useState("Day")
    const [isFeeCovered, setIsFeeCovered] = useState(false)
    const [focusedField, setFocusedField] = useState<string | null>(null)

    // Styles
    const containerStyle: CSSProperties = {
        width: "100%",
        padding,
        backgroundColor: backgroundColor,
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        borderRadius: containerRadius,
        display: "flex",
        flexDirection: "column",
        gap,
        ...font,
        color: textColor,
        position: "relative",
        overflow: "hidden",
    }

    const labelStyle: CSSProperties = {
        fontSize: 17,
        marginBottom: 8,
        display: "block",
        color: subtitleColor,
        ...titleFont,
    }

    const rowStyle: CSSProperties = {
        display: "flex",
        gap: 8,
        width: "100%",
    }

    const inputStyle = (name: string): CSSProperties => ({
        width: "100%",
        padding: "12px 16px",
        backgroundColor: inputBackgroundColor,
        border: `1px solid ${focusedField === name ? accentColor : "transparent"}`,
        borderRadius: elementRadius,
        color: textColor,
        outline: "none",
        fontSize: 15,
        transition: "all 0.2s ease",
        boxShadow:
            focusedField === name
                ? "0px 1px 2px 0px rgba(0, 0, 0, 0.12)"
                : "none",
        ...font,
    })

    const buttonGroupStyle: CSSProperties = {
        display: "flex",
        backgroundColor: inputBackgroundColor,
        padding: 0,
        borderRadius: elementRadius,
        gap: 0,
    }

    const toggleButtonStyle = (isSelected: boolean): CSSProperties => ({
        flex: 1,
        padding: "12px 0",
        borderRadius: elementRadius,
        border: "none",
        backgroundColor: "transparent",
        color: isSelected ? "#000000" : textColor,
        cursor: "pointer",
        fontSize: 14,
        fontWeight: 500,
        transition: "color 0.2s ease",
        ...font,
        position: "relative",
        isolation: "isolate",
    })

    const amountButtonStyle = (val: string): CSSProperties => ({
        flex: 1,
        padding: "12px 0",
        borderRadius: elementRadius,
        border: "none",
        backgroundColor: amount === val ? "#FFFFFF" : inputBackgroundColor,
        color: amount === val ? textColor : placeholderColor,
        cursor: "pointer",
        fontSize: 15,
        fontWeight: 500,
        transition: "all 0.2s ease",
        ...font,
    })

    return (
        <div id={uniqueId} style={containerStyle}>
            {/* Frequency Section */}
            <div>
                <span style={labelStyle}>Donate</span>
                {/* Segmented Control */}
                <div style={buttonGroupStyle}>
                    {["One-time", "Monthly"].map((opt) => {
                        const isSelected = frequency === opt
                        return (
                            <button
                                key={opt}
                                style={toggleButtonStyle(isSelected)}
                                onClick={() => setFrequency(opt)}
                            >
                                {isSelected && (
                                    <motion.div
                                        layoutId="frequency-bg"
                                        style={{
                                            position: "absolute",
                                            top: 0,
                                            left: 0,
                                            right: 0,
                                            bottom: 0,
                                            backgroundColor: "#FFFFFF",
                                            borderRadius: elementRadius,
                                            zIndex: -1,
                                            boxShadow:
                                                "0 1px 2px rgba(0,0,0,0.1)",
                                        }}
                                        transition={{
                                            type: "spring",
                                            stiffness: 300,
                                            damping: 35,
                                        }}
                                    />
                                )}
                                <span
                                    style={{ position: "relative", zIndex: 1 }}
                                >
                                    {opt}
                                </span>
                            </button>
                        )
                    })}
                </div>
            </div>

            {/* Amount Section */}
            <div>
                <span style={labelStyle}>Amount</span>
                <div style={{ display: "flex", gap: 8 }}>
                    {["$5", "$25", "$100", "Other"].map((val) => (
                        <button
                            key={val}
                            style={amountButtonStyle(val)}
                            onClick={() => setAmount(val)}
                        >
                            {val}
                        </button>
                    ))}
                </div>
                <AnimatePresence initial={false}>
                    {amount === "Other" && (
                        <motion.div
                            key="custom-amount"
                            initial={{ height: 0, opacity: 0, borderRadius: elementRadius }}
                            animate={{ height: "auto", opacity: 1, borderRadius: elementRadius }}
                            exit={{ height: 0, opacity: 0, borderRadius: elementRadius }}
                            transition={{
                                type: "spring",
                                stiffness: 550,
                                damping: 48,
                                mass: 1,
                            }}
                            style={{ overflow: "hidden" }}
                        >
                            <div
                                style={{
                                    paddingTop: 8,
                                    padding: "8px 1px 1px 1px",
                                }}
                            >
                                <input
                                    style={inputStyle("customAmount")}
                                    placeholder="Enter amount"
                                    value={customAmount}
                                    onChange={(e) =>
                                        setCustomAmount(e.target.value)
                                    }
                                    onFocus={() =>
                                        setFocusedField("customAmount")
                                    }
                                    onBlur={() => setFocusedField(null)}
                                />
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Billing Address Section */}
            <div>
                <span style={labelStyle}>Billing Address</span>
                <div
                    style={{ display: "flex", flexDirection: "column", gap: 8 }}
                >
                    <div style={rowStyle}>
                        <input
                            style={inputStyle("firstName")}
                            placeholder="First name*"
                            autoComplete="given-name"
                            onFocus={() => setFocusedField("firstName")}
                            onBlur={() => setFocusedField(null)}
                        />
                        <input
                            style={inputStyle("lastName")}
                            placeholder="Last name*"
                            autoComplete="family-name"
                            onFocus={() => setFocusedField("lastName")}
                            onBlur={() => setFocusedField(null)}
                        />
                    </div>
                    <input
                        style={inputStyle("address")}
                        placeholder="Address*"
                        autoComplete="street-address"
                        onFocus={() => setFocusedField("address")}
                        onBlur={() => setFocusedField(null)}
                    />
                    <input
                        style={inputStyle("email")}
                        placeholder="Email*"
                        type="email"
                        autoComplete="email"
                        onFocus={() => setFocusedField("email")}
                        onBlur={() => setFocusedField(null)}
                    />
                    <input
                        style={inputStyle("phone")}
                        placeholder="Phone"
                        type="tel"
                        autoComplete="tel"
                        onFocus={() => setFocusedField("phone")}
                        onBlur={() => setFocusedField(null)}
                    />
                </div>
            </div>

            {/* Payment Section */}
            <div>
                <span style={labelStyle}>Payment</span>
                <div
                    style={{ display: "flex", flexDirection: "column", gap: 8 }}
                >
                    <input
                        style={inputStyle("card")}
                        placeholder="Credit card number*"
                        autoComplete="cc-number"
                        onFocus={() => setFocusedField("card")}
                        onBlur={() => setFocusedField(null)}
                    />
                    <div style={rowStyle}>
                        <div style={{ position: "relative", flex: 1 }}>
                            <select
                                value={selectedMonth}
                                onChange={(e) =>
                                    setSelectedMonth(e.target.value)
                                }
                                style={{
                                    ...inputStyle("month"),
                                    appearance: "none",
                                    cursor: "pointer",
                                    color:
                                        selectedMonth === "Month"
                                            ? placeholderColor
                                            : textColor,
                                }}
                                autoComplete="cc-exp-month"
                                onFocus={() => setFocusedField("month")}
                                onBlur={() => setFocusedField(null)}
                            >
                                <option value="Month">Month</option>
                                {Array.from({ length: 12 }, (_, i) => (
                                    <option key={i} value={i + 1}>
                                        {i + 1}
                                    </option>
                                ))}
                            </select>
                            <ChevronDown color={textColor} />
                        </div>
                        <div style={{ position: "relative", flex: 1 }}>
                            <select
                                value={selectedDay}
                                onChange={(e) => setSelectedDay(e.target.value)}
                                style={{
                                    ...inputStyle("day"),
                                    appearance: "none",
                                    cursor: "pointer",
                                    color:
                                        selectedDay === "Day"
                                            ? placeholderColor
                                            : textColor,
                                }}
                                onFocus={() => setFocusedField("day")}
                                onBlur={() => setFocusedField(null)}
                            >
                                <option value="Day">Day</option>
                                {Array.from({ length: 31 }, (_, i) => (
                                    <option key={i} value={i + 1}>
                                        {i + 1}
                                    </option>
                                ))}
                            </select>
                            <ChevronDown color={textColor} />
                        </div>
                        <input
                            style={{ ...inputStyle("cvv"), flex: 1 }}
                            placeholder="CVV*"
                            maxLength={4}
                            autoComplete="cc-csc"
                            onFocus={() => setFocusedField("cvv")}
                            onBlur={() => setFocusedField(null)}
                        />
                    </div>
                </div>
            </div>

            {/* Fee Coverage Checkbox */}
            {showFeeCoverage && (
                <div
                    style={{
                        display: "flex",
                        gap: 12,
                        alignItems: "flex-start",
                        cursor: "pointer",
                    }}
                    onClick={() => setIsFeeCovered(!isFeeCovered)}
                >
                    <div
                        style={{
                            width: 20,
                            height: 20,
                            borderRadius: 4,
                            border: `1px solid ${textColor}`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            marginTop: 2,
                            flexShrink: 0,
                            backgroundColor: isFeeCovered
                                ? accentColor
                                : "transparent",
                            borderColor: isFeeCovered
                                ? accentColor
                                : "rgba(255,255,255,0.3)",
                        }}
                    >
                        {isFeeCovered && (
                            <svg
                                width="12"
                                height="12"
                                viewBox="0 0 12 12"
                                fill="none"
                            >
                                <path
                                    d="M10 3L4.5 8.5L2 6"
                                    stroke="white"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                />
                            </svg>
                        )}
                    </div>
                    <span
                        style={{
                            fontSize: 13,
                            lineHeight: "1.4em",
                            opacity: 0.9,
                        }}
                    >
                        I will cover the 5% processing fee so 100% of my
                        donation goes to helping kids.
                    </span>
                </div>
            )}

            {/* Donate Button */}
            <motion.button
                onClick={() => {
                    let url = ""
                    if (frequency === "One-time") {
                        if (amount === "$5") url = linkOneTime5
                        else if (amount === "$25") url = linkOneTime25
                        else if (amount === "$100") url = linkOneTime100
                        else if (amount === "Other") url = linkOneTimeOther
                    } else {
                        if (amount === "$5") url = linkMonthly5
                        else if (amount === "$25") url = linkMonthly25
                        else if (amount === "$100") url = linkMonthly100
                        else if (amount === "Other") url = linkMonthlyOther
                    }

                    if (url) {
                        window.open(url, "_blank")
                    } else {
                        alert("Payment link not configured for this option.")
                    }
                }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                style={{
                    width: "100%",
                    padding: "16px",
                    backgroundColor: accentColor,
                    border: "none",
                    borderRadius: donateButtonRadius,
                    color: "#FFFFFF",
                    fontSize: 16,
                    fontWeight: 600,
                    cursor: "pointer",
                    marginTop: 8,
                    ...buttonFont,
                }}
            >
                Donate
            </motion.button>

            {/* Placeholder Styles Injection */}
            <style>
                {`
                    #${uniqueId} input::placeholder, #${uniqueId} textarea::placeholder {
                        color: ${placeholderColor} !important;
                        opacity: 1;
                    }
                    #${uniqueId} option {
                        background-color: #333;
                        color: white;
                    }
                `}
            </style>
        </div>
    )
}

function ChevronDown({ color }) {
    return (
        <div
            style={{
                position: "absolute",
                right: 12,
                top: "50%",
                transform: "translateY(-50%)",
                pointerEvents: "none",
            }}
        >
            <svg width="12" height="8" viewBox="0 0 12 8" fill="none">
                <path
                    d="M1 1.5L6 6.5L11 1.5"
                    stroke={color}
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity="0.5"
                />
            </svg>
        </div>
    )
}

addPropertyControls(DonationForm, {
    accentColor: {
        type: ControlType.Color,
        title: "Accent",
        defaultValue: "#0099FF",
    },
    backgroundColor: {
        type: ControlType.Color,
        title: "Background",
        defaultValue: "rgba(255, 255, 255, 0.12)",
    },
    inputBackgroundColor: {
        type: ControlType.Color,
        title: "Input Bg",
        defaultValue: "rgba(255, 255, 255, 0.24)",
    },
    textColor: {
        type: ControlType.Color,
        title: "Text",
        defaultValue: "rgba(0, 0, 0, 0.95)",
    },
    subtitleColor: {
        type: ControlType.Color,
        title: "Subtitle",
        defaultValue: "rgba(255, 255, 255, 0.65)",
    },
    placeholderColor: {
        type: ControlType.Color,
        title: "Placeholder",
        defaultValue: "rgba(0, 0, 0, 0.65)",
    },
    containerRadius: {
        type: ControlType.Number,
        title: "Radius",
        defaultValue: 28,
        min: 0,
        max: 100,
    },
    padding: {
        type: ControlType.Padding,
        title: "Padding",
        defaultValue: "16px",
    },
    gap: {
        type: ControlType.Number,
        title: "Gap",
        defaultValue: 24,
        min: 0,
        max: 100,
    },
    elementRadius: {
        type: ControlType.Number,
        title: "Elem Radius",
        defaultValue: 14,
        min: 0,
        max: 50,
    },
    donateButtonRadius: {
        type: ControlType.Number,
        title: "CTA Radius",
        defaultValue: 28,
        min: 0,
        max: 50,
    },
    showFeeCoverage: {
        type: ControlType.Boolean,
        title: "Fee Coverage",
        defaultValue: false,
        enabledTitle: "Show",
        disabledTitle: "Hide",
    },
    titleFont: {
        type: ControlType.Font,
        title: "Label Font",
        defaultValue: {
            fontSize: 17,
            lineHeight: "1.2em",
            fontWeight: 400,
        },
        controls: "extended",
        defaultFontType: "sans-serif",
    },
    font: {
        type: ControlType.Font,
        title: "Input Font",
        defaultValue: {
            fontSize: 15,
            lineHeight: "1.4em",
            fontWeight: 400,
        },
        controls: "extended",
        defaultFontType: "sans-serif",
    },
    buttonFont: {
        type: ControlType.Font,
        title: "Button Font",
        defaultValue: {
            fontSize: 16,
            lineHeight: "1.2em",
            fontWeight: 600,
        },
        controls: "extended",
        defaultFontType: "sans-serif",
    },
    linkOneTime5: {
        type: ControlType.String,
        title: "$5 One-time Link",
        defaultValue: "https://buy.stripe.com/test_cNicN79mwclV75z2Ay1Fe02",
    },
    linkOneTime25: {
        type: ControlType.String,
        title: "$25 One-time Link",
        defaultValue: "https://buy.stripe.com/test_4gM5kF42cgCbdtXa301Fe01",
    },
    linkOneTime100: {
        type: ControlType.String,
        title: "$100 One-time Link",
        defaultValue: "https://buy.stripe.com/test_8x28wRaqAadNey1dfc1Fe00",
    },
    linkOneTimeOther: {
        type: ControlType.String,
        title: "Other One-time Link",
        defaultValue: "",
        placeholder: "https://buy.stripe.com/...",
    },
    linkMonthly5: {
        type: ControlType.String,
        title: "$5 Monthly Link",
        defaultValue: "",
        placeholder: "https://buy.stripe.com/...",
    },
    linkMonthly25: {
        type: ControlType.String,
        title: "$25 Monthly Link",
        defaultValue: "",
        placeholder: "https://buy.stripe.com/...",
    },
    linkMonthly100: {
        type: ControlType.String,
        title: "$100 Monthly Link",
        defaultValue: "",
        placeholder: "https://buy.stripe.com/...",
    },
    linkMonthlyOther: {
        type: ControlType.String,
        title: "Other Monthly Link",
        defaultValue: "",
        placeholder: "https://buy.stripe.com/...",
    },
})
