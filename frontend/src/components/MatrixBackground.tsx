import React, { useEffect, useRef } from 'react';

const MatrixBackground: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    // Characters used in the Matrix rain (Katakana + Numbers + Letters)
    const characters = 'アァカサタナハマヤャラワガザダバパイィキシチニヒミリヰギジヂビピウゥクスツヌフムユュルグズブヅプエェケセテネヘメレヱゲゼデベペオォコソトノホモヨョロヲゴゾドボポヴッン0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const charArray = characters.split('');
    const fontSize = 16; // Adjust font size
    const columns = Math.floor(width / fontSize);

    // Initialize drops (y-position for each column)
    const drops: number[] = [];
    for (let i = 0; i < columns; i++) {
      drops[i] = Math.random() * height; // Start at random heights
    }

    let animationFrameId: number;

    const draw = () => {
      // Semi-transparent black background for fading effect
      ctx.fillStyle = 'rgba(0, 0, 0, 0.04)';
      ctx.fillRect(0, 0, width, height);

      // Matrix green color for characters
      ctx.fillStyle = '#39FF14'; // Matrix Green
      ctx.font = `${fontSize}px "Roboto Mono", monospace`; // Correct

      // Loop through columns
      for (let i = 0; i < columns; i++) {
        // Get a random character
        const text = charArray[Math.floor(Math.random() * charArray.length)];

        // Draw the character at x, y position
        const x = i * fontSize;
        const y = drops[i] * fontSize;
        ctx.fillText(text, x, y);

        // Reset drop to top randomly or if it goes off screen
        if (y > height && Math.random() > 0.975) { // Adjust 0.975 for stream density/gaps
          drops[i] = 0;
        }

        // Move the drop down
        drops[i]++;
      }

      animationFrameId = requestAnimationFrame(draw);
    };

    const handleResize = () => {
        cancelAnimationFrame(animationFrameId); // Stop previous animation
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
        // Reinitialize drops based on new width (optional, can cause flicker)
        // const newColumns = Math.floor(width / fontSize);
        // drops.length = 0; // Clear old drops
        // for (let i = 0; i < newColumns; i++) {
        //     drops[i] = Math.random() * height;
        // }
        // Or simply restart drawing, columns might adjust implicitly if loop uses updated width
        draw(); // Restart animation
    };

    window.addEventListener('resize', handleResize);
    draw(); // Start animation

    // Cleanup function
    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
    };
  }, []); // Empty dependency array ensures this runs only once on mount

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed', // Fixed position behind everything
        top: 0,
        left: 0,
        zIndex: -1,       // Ensure it's behind the main content
        display: 'block', // Prevent extra space below canvas
      }}
    />
  );
};

export default MatrixBackground;
