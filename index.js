/* index.js */

document.addEventListener('DOMContentLoaded', () => {
    // 1. Hero Text Fade-in Effect
    const heroTitle = document.getElementById('hero-title');
    const heroDesc = document.getElementById('hero-desc');
    const ctaBtn = document.querySelector('.cta-button');

    // 초기 상태 설정
    [heroTitle, heroDesc, ctaBtn].forEach(el => {
        if (el) el.style.opacity = '0';
        if (el) el.style.transform = 'translateY(20px)';
        if (el) el.style.transition = 'all 1s ease-out';
    });

    // 순차적 페이드인
    setTimeout(() => {
        heroTitle.style.opacity = '1';
        heroTitle.style.transform = 'translateY(0)';
    }, 200);

    setTimeout(() => {
        heroDesc.style.opacity = '1';
        heroDesc.style.transform = 'translateY(0)';
    }, 500);

    setTimeout(() => {
        ctaBtn.style.opacity = '1';
        ctaBtn.style.transform = 'translateY(0)';
    }, 800);

    // 2. Intersection Observer for Feature Cards
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    const featureCards = document.querySelectorAll('.feature-card');
    featureCards.forEach((card, index) => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(30px)';
        card.style.transition = `all 0.6s ease-out ${index * 0.15}s`; // 순차적 애니메이션
        observer.observe(card);
    });

    // 3. Mouse Move Parallax Effect (Subtle)
    document.addEventListener('mousemove', (e) => {
        const moveX = (e.clientX - window.innerWidth / 2) * 0.01;
        const moveY = (e.clientY - window.innerHeight / 2) * 0.01;
        
        const glows = document.querySelectorAll('.glow-circle');
        glows.forEach(glow => {
            glow.style.transform = `translate(${moveX}px, ${moveY}px)`;
        });
    });
});
