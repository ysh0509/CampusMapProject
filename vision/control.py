import socket
import threading
import time
import os

# =========================================================
# CONFIGURATION (환경 설정)
# =========================================================
# 1. ESP32-S3 (제어 보드) 설정
# ESP32-S3의 IP 주소를 입력하세요 (LCD에 표시된 IP)
ESP32_S3_IP = "192.168.0.XX" 
ESP32_S3_PORT = 4210

# 2. Local UDP 설정 (main.py로부터 데이터를 받을 포트)
LOCAL_UDP_IP = "0.0.0.0"  # 모든 인터페이스에서 수신
LOCAL_UDP_PORT = 5005      # main.py가 데이터를 보낼 포트

# =========================================================
# LOGGING
# =========================================================
def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] [CONTROL] {msg}")

# =========================================================
# UDP BRIDGE LOGIC
# =========================================================

def start_bridge():
    """
    main.py로부터 데이터를 받아 ESP32-S3로 중계하는 메인 루프
    """
    # 1. Local UDP Socket (Server 모드: main.py의 데이터를 기다림)
    local_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    local_sock.bind((LOCAL_UDP_IP, LOCAL_UDP_PORT))
    
    # 2. Remote UDP Socket (Client 모드: ESP32-S3로 데이터를 보냄)
    remote_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

    log(f"Bridge Started. Listening on Local Port: {LOCAL_UDP_PORT}")
    log(f"Target ESP32-S3 IP: {ESP32_S3_IP}:{ESP32_S3_PORT}")

    try:
        while True:
            # main.py로부터 데이터 수신
            data, addr = local_sock.recvfrom(1024)
            message = data.decode('utf-8').strip()
            
            if message:
                log(f"Received from Main: {message}")
                
                # 받은 데이터를 그대로 ESP32-S3로 전달 (Relay)
                try:
                    remote_sock.sendto(message.encode(), (ESP32_S3_IP, ESP32_S3_PORT))
                    log(f"Relayed to ESP32-S3: {message}")
                except Exception as e:
                    log(f"Failed to relay to ESP32: {e}")

    except Exception as e:
        log(f"Bridge Error: {e}")
    finally:
        local_sock.close()
        remote_sock.close()
        log("Bridge Stopped.")

# =========================================================
# MAIN EXECUTION
# =========================================================
if __name__ == "__main__":
    print("====================================================")
    print("   Smart Campus Control Bridge (UDP Relay)")
    print("====================================================")
    print(f"  - Local Listening Port: {LOCAL_UDP_PORT}")
    print(f"  - Target ESP32-S3 IP:   {ESP32_S3_IP}")
    print("====================================================")
    
    # 브릿지 스레드 시작
    bridge_thread = threading.Thread(target=start_bridge, daemon=True)
    bridge_thread.start()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        log("System exiting...")
