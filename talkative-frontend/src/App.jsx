import React, { useState, useRef, useEffect } from "react";
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  MessageSquare,
  Users,
  SkipForward,
  Send,
} from "lucide-react";
import io from "socket.io-client";

// Dynamic socket URL based on current host
const getSocketURL = () => {
  const currentHost = window.location.hostname;
  const port = 3001;
  const protocol = window.location.protocol;

  if (currentHost !== "localhost" && currentHost !== "127.0.0.1") {
    return `${protocol}//${currentHost}:${port}`;
  }

  return `${protocol}//localhost:${port}`;
};

const SOCKET_URL = getSocketURL();

function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isChatting, setIsChatting] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(false);
  const [isAudioEnabled, setIsAudioEnabled] = useState(false);
  const [hasVideoPermission, setHasVideoPermission] = useState(false);
  const [socket, setSocket] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [peerConnection, setPeerConnection] = useState(null);
  
  // Chat state
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState("");

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    console.log("Current host:", window.location.hostname);
    console.log("Attempting to connect to:", SOCKET_URL);
    const newSocket = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
      timeout: 10000,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });
    setSocket(newSocket);

    newSocket.on("connect", () => {
      console.log("✅ Successfully connected to server");
      setIsConnected(true);
    });

    newSocket.on("disconnect", (reason) => {
      console.log("❌ Disconnected from server:", reason);
      setIsConnected(false);
    });

    newSocket.on("connect_error", (error) => {
      console.error("❌ Connection error:", error.message);
      console.log("💡 Make sure the backend server is running on port 3001");
      setIsConnected(false);
    });

    newSocket.on("reconnect", (attemptNumber) => {
      console.log("🔄 Reconnected after", attemptNumber, "attempts");
    });

    newSocket.on("reconnect_error", (error) => {
      console.log("🔄 Reconnection failed:", error.message);
    });

    newSocket.on("matched", handleMatched);
    newSocket.on("offer", handleOffer);
    newSocket.on("answer", handleAnswer);
    newSocket.on("ice-candidate", handleIceCandidate);
    newSocket.on("peer-disconnected", handlePeerDisconnected);
    newSocket.on("chat-message", handleChatMessage);

    return () => {
      console.log("🔌 Closing socket connection");
      newSocket.close();
    };
  }, []);

  // Scroll to bottom when new message arrives
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleMatched = async () => {
    setIsSearching(false);
    setIsChatting(true);
    await initializePeerConnection();
  };

  const initializePeerConnection = async () => {
    try {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });

      pc.ontrack = (event) => {
        console.log("Received remote track:", event.track.kind);
        setRemoteStream(event.streams[0]);
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = event.streams[0];
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate && socket) {
          console.log("Sending ICE candidate");
          socket.emit("ice-candidate", event.candidate);
        }
      };

      pc.onconnectionstatechange = () => {
        console.log("Connection state:", pc.connectionState);
      };

      setPeerConnection(pc);
    } catch (error) {
      console.error("Error initializing peer connection:", error);
    }
  };

  const handleOffer = async (offer) => {
    if (!peerConnection) return;

    console.log("Received offer, creating answer...");
    await peerConnection.setRemoteDescription(offer);
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit("answer", answer);
  };

  const handleAnswer = async (answer) => {
    if (!peerConnection) return;
    console.log("Received answer");
    await peerConnection.setRemoteDescription(answer);
  };

  const handleIceCandidate = async (candidate) => {
    if (!peerConnection) return;
    console.log("Received ICE candidate");
    await peerConnection.addIceCandidate(candidate);
  };

  const handleChatMessage = (message) => {
    setMessages((prev) => [...prev, { ...message, sender: "stranger" }]);
  };

  const sendMessage = (e) => {
    e.preventDefault();
    if (!messageInput.trim() || !socket) return;

    const message = {
      text: messageInput.trim(),
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, { ...message, sender: "you" }]);
    socket.emit("chat-message", message);
    setMessageInput("");
  };

  const startSearch = () => {
    setIsSearching(true);
    socket.emit("find-peer");
  };

  const stopSearch = () => {
    setIsSearching(false);
    socket.emit("stop-search");
  };

  const requestMediaAccess = async () => {
    try {
      console.log("Requesting media access...");

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error(
          "Your browser doesn't support camera/microphone access. You can still use text chat."
        );
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      console.log("Media access granted, tracks:", stream.getTracks().length);

      setLocalStream(stream);
      setHasVideoPermission(true);
      setIsVideoEnabled(true);
      setIsAudioEnabled(true);

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      if (peerConnection) {
        stream.getTracks().forEach((track) => {
          console.log("Adding track:", track.kind);
          peerConnection.addTrack(track, stream);
        });

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit("offer", offer);
      }
    } catch (error) {
      console.error("Error accessing media devices:", error);
      
      let errorMessage = error.message;
      if (error.name === "NotAllowedError") {
        errorMessage = "Camera/microphone access was denied. You can still use text chat.";
      } else if (error.name === "NotFoundError") {
        errorMessage = "No camera or microphone found. You can still use text chat.";
      }
      
      alert(`Camera/Microphone error: ${errorMessage}`);
    }
  };

  const toggleVideo = () => {
    if (!hasVideoPermission) {
      requestMediaAccess();
      return;
    }

    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoEnabled(videoTrack.enabled);
      }
    }
  };

  const toggleAudio = () => {
    if (!hasVideoPermission) {
      requestMediaAccess();
      return;
    }

    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioEnabled(audioTrack.enabled);
      }
    }
  };

  const handlePeerDisconnected = () => {
    setIsChatting(false);
    setRemoteStream(null);
    setMessages([]);
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
  };

  const skipPeer = () => {
    socket.emit("skip-peer");
    setIsChatting(false);
    setRemoteStream(null);
    setMessages([]);
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    startSearch();
  };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f8fafc" }}>
      {/* Header */}
      <header className="header">
        <div className="container">
          <div className="header-content">
            <div className="header-brand">
              <MessageSquare size={24} />
              <h1>Talkative</h1>
            </div>
            <div className="status-indicator">
              <div
                className={`status-dot ${
                  isConnected ? "status-connected" : "status-disconnected"
                }`}
              />
              <span>{isConnected ? "Connected" : "Disconnected"}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content">
        <div className="container">
          {!isChatting && !isSearching && (
            <div className="welcome-screen">
              <div className="space-y-6">
                <div className="text-center space-y-4">
                  <h2 className="welcome-title">Meet new people</h2>
                  <p className="welcome-subtitle">
                    Start with text chat, add video later if you want
                  </p>
                </div>

                <div className="card">
                  <div className="card-content space-y-4">
                    <button
                      onClick={startSearch}
                      className="btn btn-primary btn-lg btn-full"
                      disabled={!isConnected}
                    >
                      <MessageSquare size={16} />
                      Start Chatting
                    </button>

                    <div className="text-xs text-muted text-center">
                      Camera and microphone are optional - you can chat with text first
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {isSearching && (
            <div className="searching-screen">
              <div className="space-y-6">
                <div className="text-center space-y-4">
                  <div className="spinner" />
                  <h2 className="searching-title">
                    Finding someone to chat with...
                  </h2>
                  <p className="searching-subtitle">
                    You'll start with text chat
                  </p>
                </div>

                <button
                  onClick={stopSearch}
                  className="btn btn-outline btn-full"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {isChatting && (
            <div className="chat-first-layout">
              {/* Chat Panel - Primary */}
              <div className="chat-main-panel">
                <div className="chat-header">
                  <h3>Chat with Stranger</h3>
                  <div className="chat-header-actions">
                    <span className="text-sm text-muted">
                      {hasVideoPermission ? "Video enabled" : "Text only"}
                    </span>
                  </div>
                </div>

                <div className="chat-messages">
                  {messages.length === 0 ? (
                    <div className="chat-empty">
                      <MessageSquare size={24} />
                      <p>Say hello to start the conversation!</p>
                      <small className="text-muted">You can enable video anytime using the controls below</small>
                    </div>
                  ) : (
                    messages.map((message, index) => (
                      <div
                        key={index}
                        className={`message ${
                          message.sender === "you" ? "message-sent" : "message-received"
                        }`}
                      >
                        <div className="message-content">
                          <p>{message.text}</p>
                          <span className="message-time">
                            {new Date(message.timestamp).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                  <div ref={messagesEndRef} />
                </div>

                <form onSubmit={sendMessage} className="chat-input">
                  <input
                    type="text"
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    placeholder="Type a message..."
                    className="message-input"
                    autoFocus
                  />
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={!messageInput.trim()}
                  >
                    <Send size={16} />
                  </button>
                </form>
              </div>

              {/* Video Section - Secondary */}
              {(hasVideoPermission || remoteStream) && (
                <div className="video-side-panel">
                  <div className="video-grid-compact">
                    {remoteStream && (
                      <div className="card">
                        <div className="video-container-small">
                          <video
                            ref={remoteVideoRef}
                            autoPlay
                            playsInline
                            className="video-element"
                          />
                          <div className="video-label">Stranger</div>
                        </div>
                      </div>
                    )}

                    {hasVideoPermission && (
                      <div className="card">
                        <div className="video-container-small">
                          <video
                            ref={localVideoRef}
                            autoPlay
                            playsInline
                            muted
                            className="video-element"
                          />
                          <div className="video-label">You</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Controls */}
              <div className="controls-bottom">
                <button
                  onClick={toggleVideo}
                  className={`btn btn-lg ${
                    hasVideoPermission && isVideoEnabled ? "btn-primary" : "btn-outline"
                  }`}
                  title={!hasVideoPermission ? "Enable camera" : isVideoEnabled ? "Turn off camera" : "Turn on camera"}
                >
                  {hasVideoPermission && isVideoEnabled ? (
                    <Video size={16} />
                  ) : (
                    <VideoOff size={16} />
                  )}
                </button>

                <button
                  onClick={toggleAudio}
                  className={`btn btn-lg ${
                    hasVideoPermission && isAudioEnabled ? "btn-primary" : "btn-outline"
                  }`}
                  title={!hasVideoPermission ? "Enable microphone" : isAudioEnabled ? "Mute microphone" : "Unmute microphone"}
                >
                  {hasVideoPermission && isAudioEnabled ? (
                    <Mic size={16} />
                  ) : (
                    <MicOff size={16} />
                  )}
                </button>

                <button onClick={skipPeer} className="btn btn-outline btn-lg">
                  <SkipForward size={16} />
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
