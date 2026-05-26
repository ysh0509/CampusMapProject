#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <ESP32Servo.h>
#include <Ds1302.h>
#include <IRremoteESP8266.h>
#include <IRrecv.h>
#include <IRutils.h>

// --- 핀 정의 (기존 유지 및 추가) ---
#define LED_RED_STATUS 4
#define LED_BLUE_STATUS 5
#define RGB_R 6
#define RGB_G 7
#define RGB_B 15
#define LCD_SDA 8
#define LCD_SCL 9
#define SERVO_PIN 18
#define FAN_PIN 19
#define BUZZER_PIN 21
#define TEMP_SENSOR_PIN 34
#define IR_RECEIVE_PIN 35
#define RST_PIN 25
#define DAT_PIN 23
#define CLK_PIN 22

// --- 초음파 센서 핀 추가 ---
#define TRIG_UP 13
#define ECHO_UP 12
#define TRIG_DOWN 14
#define ECHO_DOWN 27

// --- 상수 및 설정 ---
const float TEMP_THRESHOLD = 35.0;
int currentAngle = 0;
int targetAngle = 0;
String congestionLevel = "LOW";

// 객체 생성
LiquidCrystal_I2C lcd(0x27, 16, 2); 
Servo myServo;
DS1302 rtc(CLK_PIN, DAT_PIN, RST_PIN);
IRrecv irrecv(IR_RECEIVE_PIN);
decode_results results;

// --- 함수 선언 ---
void updateDisplay(int people, float temp, String level, float dUp, float dDown);
void setRGB(int r, int g, int b);
void setRGBByLevel(String level);
void moveServoSoftly(int target);
void handleIR();
void handleTemp();
float getDistance(int trig, int echo); // 초음파 거리 측정 함수

void setup() {
  Serial.begin(115200);
  
  // 핀 모드 설정
  pinMode(LED_RED_STATUS, OUTPUT);
  pinMode(LED_BLUE_STATUS, OUTPUT);
  pinMode(RGB_R, OUTPUT);
  pinMode(RGB_G, OUTPUT);
  pinMode(RGB_B, OUTPUT);
  pinMode(FAN_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);

  // 초음파 핀 설정
  pinMode(TRIG_UP, OUTPUT);
  pinMode(ECHO_UP, INPUT);
  pinMode(TRIG_DOWN, OUTPUT);
  pinMode(ECHO_DOWN, INPUT);

  digitalWrite(LED_RED_STATUS, HIGH);
  digitalWrite(LED_BLUE_STATUS, LOW);

  Wire.begin(LCD_SDA, LCD_SCL);
  lcd.init();
  lcd.backlight();
  lcd.print("System Booting...");

  myServo.attach(SERVO_PIN);
  myServo.write(currentAngle);
  rtc.halt(false);
  rtc.writeTime(DateTime(2026, 5, 25, 14, 30, 0));

  irrecv.enableIRIn();
  delay(2000);
  lcd.clear();
}

void loop() {
  // 1. PC(Python)로부터 데이터 수신 및 초음파 거리 측정
  if (Serial.available() > 0) {
    digitalWrite(LED_RED_STATUS, LOW);
    digitalWrite(LED_BLUE_STATUS, HIGH);
    digitalWrite(FAN_PIN, HIGH);

    // PC로부터 데이터 파싱 (확장된 포맷: P:12,T:30.5,L:LOW)
    String data = Serial.readStringUntil('\n');
    
    int pIdx = data.indexOf('P:');
    int tIdx = data.indexOf(',T:');
    int lIdx = data.indexOf(',L:');

    if (pIdx != -1 && tIdx != -1 && lIdx != -1) {
      int people = data.substring(pIdx + 2, tIdx).toInt();
      float temp = data.substring(tIdx + 3, lIdx).toFloat();
      congestionLevel = data.substring(lIdx + 3);

      // --- [추가] 초음파 거리 측정 ---
      float distUp = getDistance(TRIG_UP, ECHO_UP);
      float distDown = getDistance(TRIG_DOWN, ECHO_DOWN);

      // LCD 업데이트 (거리 데이터 포함)
      updateDisplay(people, temp, congestionLevel, distUp, distDown);
      setRGBByLevel(congestionLevel);

      // --- [추가] Python 서버로 거리 데이터 재전송 (Feedback Loop) ---
      // Python이 보낸 데이터에 거리 값을 다시 담아 보내면, Python이 이를 수신하여 3D 분석을 수행함
      // 포맷: P:인원,T:온도,L:단계,D_UP:거리,D_DOWN:거리
      Serial.print("P:"); Serial.print(people);
      Serial.print(",T:"); Serial.print(temp, 1);
      Serial.print(",L:"); Serial.print(congestionLevel);
      Serial.print(",D_UP:"); Serial.print(distUp, 2);
      Serial.print(",D_DOWN:"); Serial.println(distDown, 2);
    }
  }

  handleIR();
  handleTemp();
  if (currentAngle != targetAngle) moveServoSoftly(targetAngle);

  static unsigned long lastTimeUpdate = 0;
  if (millis() - lastTimeUpdate > 1000) {
    lastTimeUpdate = millis();
  }
}

// --- 초음파 거리 측정 함수 ---
float getDistance(int trig, int echo) {
  digitalWrite(trig, LOW);
  delayMicroseconds(2);
  digitalWrite(trig, HIGH);
  delayMicroseconds(10);
  digitalWrite(trig, LOW);
  
  long duration = pulseIn(echo, HIGH, 30000); // 30ms 타임아웃
  if (duration == 0) return 0.0; // 측정 실패 시 0 반환
  
  // 거리(cm) = 시간 * 음속(340m/s) / 2
  float distance = duration * 0.034 / 2.0;
  return distance;
}

void setRGBByLevel(String level) {
  if (level == "LOW") setRGB(0, 255, 0);
  else if (level == "MID") setRGB(255, 255, 0);
  else if (level == "HIGH") setRGB(255, 0, 0);
}

void setRGB(int r, int g, int b) {
  analogWrite(RGB_R, r);
  analogWrite(RGB_G, g);
  analogWrite(RGB_B, b);
}

void moveServoSoftly(int target) {
  if (currentAngle < target) {
    for (int i = currentAngle; i <= target; i++) {
      myServo.write(i);
      currentAngle = i;
      delay(20);
    }
  } else {
    for (int i = currentAngle; i >= target; i--) {
      myServo.write(i);
      currentAngle = i;
      delay(20);
    }
  }
}

void handleIR() {
  if (irrecv.decode(&results)) {
    unsigned long code = results.value;
    if (code == 0xFF30CF) targetAngle = 0;
    else if (code == 0xFF18E7) targetAngle = 90;
    else if (code == 0xFF7A85) targetAngle = 180;
    irrecv.resume(); 
  }
}

void handleTemp() {
  int analogVal = analogRead(TEMP_SENSOR_PIN);
  float voltage = analogVal * (3.3 / 4095.0);
  float temp = voltage * 100.0;

  if (temp > TEMP_THRESHOLD) {
    digitalWrite(FAN_PIN, HIGH);
    digitalWrite(BUZZER_PIN, HIGH);
  } else {
    digitalWrite(BUZZER_PIN, LOW);
  }
}

void updateDisplay(int people, float temp, String level, float dUp, float dDown) {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("P:"); lcd.print(people);
  lcd.print(" T:"); lcd.print(temp, 1);
  
  lcd.setCursor(0, 1);
  lcd.print(level);
  lcd.print(" U:"); lcd.print(dUp, 1); // Up 거리 표시
  lcd.print(" D:"); lcd.print(dDown, 1); // Down 거리 표시
}
