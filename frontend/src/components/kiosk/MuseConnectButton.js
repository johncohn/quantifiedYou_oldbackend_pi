/**
 * MuseConnectButton - Prominent connect button for kiosk mode
 *
 * - Large button when disconnected
 * - Shows connection progress
 * - Minimizes to status indicator when connected
 * - Shows reconnection status during auto-reconnect
 */

import React, { useState, useEffect } from 'react';
import { kioskMuse, ConnectionState } from '../../utility/kiosk-muse';

const styles = {
  container: {
    position: 'fixed',
    top: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 1000,
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },

  // Large connect button
  connectButton: {
    padding: '20px 60px',
    fontSize: '24px',
    fontWeight: 'bold',
    color: 'white',
    backgroundColor: '#4CAF50',
    border: 'none',
    borderRadius: '12px',
    cursor: 'pointer',
    boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
    transition: 'all 0.3s ease',
  },

  connectButtonHover: {
    backgroundColor: '#45a049',
    transform: 'scale(1.02)',
  },

  // Status indicator (minimized when connected)
  statusIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 20px',
    borderRadius: '25px',
    fontSize: '14px',
    fontWeight: '500',
    boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
  },

  statusDot: {
    width: '12px',
    height: '12px',
    borderRadius: '50%',
    animation: 'pulse 2s infinite',
  },

  // Status colors
  connected: {
    backgroundColor: 'rgba(76, 175, 80, 0.9)',
    color: 'white',
  },

  connecting: {
    backgroundColor: 'rgba(33, 150, 243, 0.9)',
    color: 'white',
  },

  reconnecting: {
    backgroundColor: 'rgba(255, 152, 0, 0.9)',
    color: 'white',
  },

  error: {
    backgroundColor: 'rgba(244, 67, 54, 0.9)',
    color: 'white',
  },

  idle: {
    backgroundColor: 'rgba(158, 158, 158, 0.9)',
    color: 'white',
  },
};

// CSS for pulse animation
const pulseKeyframes = `
  @keyframes pulse {
    0% { opacity: 1; }
    50% { opacity: 0.5; }
    100% { opacity: 1; }
  }
  @keyframes blink {
    0% { opacity: 1; }
    50% { opacity: 0.3; }
    100% { opacity: 1; }
  }
`;

export function MuseConnectButton() {
  const [state, setState] = useState(kioskMuse.getState());
  const [deviceName, setDeviceName] = useState(kioskMuse.getDeviceName());
  const [isHovered, setIsHovered] = useState(false);
  const [autoConnectTried, setAutoConnectTried] = useState(false);

  useEffect(() => {
    // Subscribe to state changes
    const unsubscribe = kioskMuse.onStateChange((newState, name) => {
      setState(newState);
      setDeviceName(name);
    });

    // Try auto-connect on mount (for previously paired devices)
    if (!autoConnectTried) {
      setAutoConnectTried(true);
      kioskMuse.tryAutoConnect().then(success => {
        if (success) {
          console.log('[KioskUI] Auto-connected to previously paired device');
        } else {
          console.log('[KioskUI] No previously paired device - waiting for manual connect');
        }
      });
    }

    return unsubscribe;
  }, [autoConnectTried]);

  const handleConnect = async () => {
    if (state === ConnectionState.IDLE || state === ConnectionState.ERROR) {
      await kioskMuse.connect();
    }
  };

  const handleDisconnect = async () => {
    await kioskMuse.disconnect();
  };

  const getStatusStyle = () => {
    switch (state) {
      case ConnectionState.STREAMING:
      case ConnectionState.CONNECTED:
        return styles.connected;
      case ConnectionState.CONNECTING:
      case ConnectionState.SEARCHING:
        return styles.connecting;
      case ConnectionState.RECONNECTING:
        return styles.reconnecting;
      case ConnectionState.ERROR:
        return styles.error;
      default:
        return styles.idle;
    }
  };

  const getStatusText = () => {
    switch (state) {
      case ConnectionState.STREAMING:
        return `${deviceName || 'Muse'} - Streaming`;
      case ConnectionState.CONNECTED:
        return `${deviceName || 'Muse'} - Connected`;
      case ConnectionState.CONNECTING:
        return 'Connecting...';
      case ConnectionState.SEARCHING:
        return 'Searching...';
      case ConnectionState.RECONNECTING:
        return 'Reconnecting...';
      case ConnectionState.ERROR:
        return 'Connection Error';
      default:
        return 'Disconnected';
    }
  };

  const getDotColor = () => {
    switch (state) {
      case ConnectionState.STREAMING:
      case ConnectionState.CONNECTED:
        return '#00ff00';
      case ConnectionState.CONNECTING:
      case ConnectionState.SEARCHING:
        return '#2196F3';
      case ConnectionState.RECONNECTING:
        return '#ff9800';
      case ConnectionState.ERROR:
        return '#f44336';
      default:
        return '#9e9e9e';
    }
  };

  const showButton = state === ConnectionState.IDLE || state === ConnectionState.ERROR;

  return (
    <div style={styles.container}>
      {/* Inject keyframes */}
      <style>{pulseKeyframes}</style>

      {showButton ? (
        // Large connect button
        <button
          style={{
            ...styles.connectButton,
            ...(isHovered ? styles.connectButtonHover : {}),
            ...(state === ConnectionState.ERROR ? { backgroundColor: '#f44336' } : {}),
          }}
          onClick={handleConnect}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          {state === ConnectionState.ERROR ? 'Retry Connection' : 'Connect Muse'}
        </button>
      ) : (
        // Minimized status indicator
        <div
          style={{
            ...styles.statusIndicator,
            ...getStatusStyle(),
            cursor: state === ConnectionState.STREAMING ? 'pointer' : 'default',
          }}
          onClick={state === ConnectionState.STREAMING ? handleDisconnect : undefined}
          title={state === ConnectionState.STREAMING ? 'Click to disconnect' : ''}
        >
          <div
            style={{
              ...styles.statusDot,
              backgroundColor: getDotColor(),
              animation: state === ConnectionState.RECONNECTING
                ? 'blink 0.5s infinite'
                : state === ConnectionState.STREAMING
                  ? 'pulse 2s infinite'
                  : 'none',
            }}
          />
          <span>{getStatusText()}</span>
        </div>
      )}
    </div>
  );
}

export default MuseConnectButton;
