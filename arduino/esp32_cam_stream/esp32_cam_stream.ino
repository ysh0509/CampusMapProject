#include "esp_camera.h"
#include <WiFi.h>
#include "esp_http_server.h"

extern "C" {
#include "fb_gfx.h"
}

// ======================================================
// Camera Model
// ======================================================
#define CAMERA_MODEL_AI_THINKER
#include "camera_pins.h"

// ======================================================
// WiFi
// ======================================================
const char* ssid     = "Seong S25Ultra";
const char* password = "01081399928";

// ======================================================
// Flash LED
// ======================================================
#define LED_PIN 4

// ======================================================
// HTTP Server
// ======================================================
static httpd_handle_t stream_httpd = NULL;

// ======================================================
// MJPEG Stream Handler
// ======================================================
static esp_err_t stream_handler(httpd_req_t *req)
{
    camera_fb_t *fb = NULL;
    esp_err_t res = ESP_OK;

    char part_buf[64];

    static const char* STREAM_CONTENT_TYPE =
        "multipart/x-mixed-replace;boundary=frame";

    static const char* STREAM_BOUNDARY =
        "\r\n--frame\r\n";

    static const char* STREAM_PART =
        "Content-Type: image/jpeg\r\n"
        "Content-Length: %u\r\n\r\n";

    // 응답 타입 설정
    res = httpd_resp_set_type(
        req,
        STREAM_CONTENT_TYPE
    );

    if (res != ESP_OK) {
        return res;
    }

    // 무한 스트리밍
    while (true)
    {
        // 카메라 프레임 가져오기
        fb = esp_camera_fb_get();

        if (!fb)
        {
            Serial.println(
                "Camera capture failed"
            );

            httpd_resp_send_500(req);

            break;
        }

        // boundary 전송
        res = httpd_resp_send_chunk(
            req,
            STREAM_BOUNDARY,
            strlen(STREAM_BOUNDARY)
        );

        // JPEG 헤더 전송
        if (res == ESP_OK)
        {
            size_t hlen = snprintf(
                part_buf,
                sizeof(part_buf),
                STREAM_PART,
                fb->len
            );

            res = httpd_resp_send_chunk(
                req,
                part_buf,
                hlen
            );
        }

        // JPEG 데이터 전송
        if (res == ESP_OK)
        {
            res = httpd_resp_send_chunk(
                req,
                (const char*)fb->buf,
                fb->len
            );
        }

        // 프레임 반환
        esp_camera_fb_return(fb);

        // 연결 종료 시 탈출
        if (res != ESP_OK) {
            break;
        }

        // watchdog 방지
        yield();
    }

    return res;
}

// ======================================================
// LED Brightness Handler
// 사용 예시:
// http://IP:81/led?value=255
// ======================================================
static esp_err_t led_handler(httpd_req_t *req)
{
    char query[32];

    if (
        httpd_req_get_url_query_str(
            req,
            query,
            sizeof(query)
        ) == ESP_OK
    )
    {
        char value[8];

        if (
            httpd_query_key_value(
                query,
                "value",
                value,
                sizeof(value)
            ) == ESP_OK
        )
        {
            int brightness = atoi(value);

            // 밝기 제한
            brightness = constrain(
                brightness,
                0,
                255
            );

            // PWM 출력
            ledcWrite(
                LED_PIN,
                brightness
            );

            Serial.printf(
                "LED Brightness: %d\n",
                brightness
            );
        }
    }

    httpd_resp_set_type(
        req,
        "text/plain"
    );

    httpd_resp_send(
        req,
        "OK",
        HTTPD_RESP_USE_STRLEN
    );

    return ESP_OK;
}

// ======================================================
// Main Page
// ======================================================
static esp_err_t index_handler(httpd_req_t *req)
{
    const char* html =
        "<!DOCTYPE html>"
        "<html>"
        "<head>"
        "<title>ESP32-CAM</title>"
        "<meta name='viewport' content='width=device-width, initial-scale=1'>"
        "</head>"

        "<body style='margin:0;background:black;'>"

        "<img "
        "src='/stream' "
        "style='width:100vw;height:100vh;object-fit:contain;'>"

        "</body>"
        "</html>";

    httpd_resp_set_type(
        req,
        "text/html"
    );

    return httpd_resp_send(
        req,
        html,
        strlen(html)
    );
}

// ======================================================
// Start HTTP Server
// ======================================================
void startCameraServer()
{
    httpd_config_t config =
        HTTPD_DEFAULT_CONFIG();

    // 포트
    config.server_port = 81;

    // 성능 최적화
    config.max_open_sockets = 7;

    config.keep_alive_enable = true;

    config.recv_wait_timeout = 2;
    config.send_wait_timeout = 2;

    // 메인 페이지
    httpd_uri_t index_uri = {
        .uri       = "/",
        .method    = HTTP_GET,
        .handler   = index_handler,
        .user_ctx  = NULL
    };

    // 스트림
    httpd_uri_t stream_uri = {
        .uri       = "/stream",
        .method    = HTTP_GET,
        .handler   = stream_handler,
        .user_ctx  = NULL
    };

    // LED 제어
    httpd_uri_t led_uri = {
        .uri       = "/led",
        .method    = HTTP_GET,
        .handler   = led_handler,
        .user_ctx  = NULL
    };

    // 서버 시작
    if (
        httpd_start(
            &stream_httpd,
            &config
        ) == ESP_OK
    )
    {
        httpd_register_uri_handler(
            stream_httpd,
            &index_uri
        );

        httpd_register_uri_handler(
            stream_httpd,
            &stream_uri
        );

        httpd_register_uri_handler(
            stream_httpd,
            &led_uri
        );

        Serial.println(
            "Camera server started"
        );
    }
    else
    {
        Serial.println(
            "Failed to start camera server"
        );
    }
}

// ======================================================
// Setup
// ======================================================
void setup()
{
    Serial.begin(115200);

    // ==================================================
    // LED PWM 초기화
    // ESP32 Core 3.x 방식
    // ==================================================
    ledcAttach(
        LED_PIN,
        5000,
        8
    );

    // LED OFF
    ledcWrite(
        LED_PIN,
        0
    );

    // ==================================================
    // Camera Config
    // ==================================================
    camera_config_t config;

    config.ledc_channel = LEDC_CHANNEL_0;
    config.ledc_timer   = LEDC_TIMER_0;

    // Camera Data Pins
    config.pin_d0 = Y2_GPIO_NUM;
    config.pin_d1 = Y3_GPIO_NUM;
    config.pin_d2 = Y4_GPIO_NUM;
    config.pin_d3 = Y5_GPIO_NUM;
    config.pin_d4 = Y6_GPIO_NUM;
    config.pin_d5 = Y7_GPIO_NUM;
    config.pin_d6 = Y8_GPIO_NUM;
    config.pin_d7 = Y9_GPIO_NUM;

    // Clock Pins
    config.pin_xclk = XCLK_GPIO_NUM;

    // Sync Pins
    config.pin_pclk  = PCLK_GPIO_NUM;
    config.pin_vsync = VSYNC_GPIO_NUM;
    config.pin_href  = HREF_GPIO_NUM;

    // SCCB Pins
    config.pin_sscb_sda = SIOD_GPIO_NUM;
    config.pin_sscb_scl = SIOC_GPIO_NUM;

    // Power Pins
    config.pin_pwdn  = PWDN_GPIO_NUM;
    config.pin_reset = RESET_GPIO_NUM;

    // Camera Clock
    config.xclk_freq_hz = 20000000;

    // JPEG
    config.pixel_format = PIXFORMAT_JPEG;

    // ==================================================
    // 속도 최적화
    // ==================================================
    config.frame_size   = FRAMESIZE_VGA; 

    // 숫자 낮을수록 화질↑ 용량↑
    config.jpeg_quality = 12;

    // 프레임 버퍼
    config.fb_count     = 2;

    // ==================================================
    // Camera Init
    // ==================================================
    esp_err_t err =
        esp_camera_init(&config);

    if (err != ESP_OK)
    {
        Serial.printf(
            "Camera init failed: 0x%x\n",
            err
        );

        return;
    }

    Serial.println(
        "Camera init success"
    );

    // ==================================================
    // Sensor Tuning
    // ==================================================
    sensor_t *s =
        esp_camera_sensor_get();

    if (s)
    {
        s->set_brightness(s, 1);

        s->set_contrast(s, 1);

        s->set_saturation(s, 1);

        s->set_whitebal(s, 1);

        s->set_gain_ctrl(s, 1);

        s->set_exposure_ctrl(s, 1);

        s->set_dcw(s, 1);
    }

    // ==================================================
    // WiFi
    // ==================================================
    WiFi.begin(
        ssid,
        password
    );

    Serial.print(
        "Connecting WiFi"
    );

    while (
        WiFi.status()
        != WL_CONNECTED
    )
    {
        delay(300);

        Serial.print(".");
    }

    Serial.println();

    Serial.println(
        "WiFi connected"
    );

    // WiFi 절전모드 OFF
    WiFi.setSleep(false);

    // ==================================================
    // Start Server
    // ==================================================
    startCameraServer();

    Serial.print(
        "Open browser: http://"
    );

    Serial.print(
        WiFi.localIP()
    );

    Serial.println(":81/");
}

// ======================================================
// Loop
// ======================================================
void loop()
{
    // 실질적으로 사용 안 함
    yield();
}