import { Component, input, computed } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-sparkline',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="w-full h-40 relative">
      <svg class="w-full h-full overflow-visible" preserveAspectRatio="none">
        <defs>
          <linearGradient id="gradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.5" />
            <stop offset="100%" stop-color="#3b82f6" stop-opacity="0" />
          </linearGradient>
        </defs>

        <!-- Grid lines (Dotted) -->
        <line x1="0" y1="25%" x2="100%" y2="25%" stroke="#334155" stroke-width="1" stroke-dasharray="4" opacity="0.3" />
        <line x1="0" y1="50%" x2="100%" y2="50%" stroke="#334155" stroke-width="1" stroke-dasharray="4" opacity="0.3" />
        <line x1="0" y1="75%" x2="100%" y2="75%" stroke="#334155" stroke-width="1" stroke-dasharray="4" opacity="0.3" />

        <!-- Area fill -->
        <path [attr.d]="areaPath()" fill="url(#gradient)" />
        
        <!-- Smooth Line -->
        <path [attr.d]="linePath()" fill="none" stroke="#3b82f6" stroke-width="3" stroke-linecap="round" vector-effect="non-scaling-stroke" />
        
      </svg>
      
      <!-- Dynamic X-Axis Labels -->
      <div class="absolute bottom-0 w-full flex justify-between text-[10px] text-gray-500 font-medium translate-y-4 px-1">
        @for (label of labels(); track $index) {
            <span>{{ label }}</span>
        }
      </div>
    </div>
  `
})
export class SparklineComponent {
  data = input.required<number[]>();
  labels = input<string[]>(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']); // Default fallback

  // Logic to generate a smooth Bezier curve from points
  private getPath(values: number[], closeArea = false): string {
    if (!values.length) return '';

    const min = Math.min(...values) * 0.99; // slight padding
    const max = Math.max(...values) * 1.01;
    const range = max - min || 1;

    // Map data to x,y coordinates (0-100 scale)
    const points = values.map((val, i) => ({
      x: (i / (values.length - 1)) * 100,
      y: 100 - ((val - min) / range) * 100
    }));

    if (points.length < 2) {
       // Handle single point (draw a flat line)
       return closeArea 
         ? `M 0 50 L 100 50 L 100 100 L 0 100 Z` 
         : `M 0 50 L 100 50`;
    }

    // Start path
    let d = `M ${points[0].x} ${points[0].y}`;

    // Cubic Bezier Curve logic
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      
      // Control points (simple smoothing)
      const cp1x = p0.x + (p1.x - p0.x) * 0.5;
      const cp1y = p0.y;
      const cp2x = p0.x + (p1.x - p0.x) * 0.5;
      const cp2y = p1.y;

      d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p1.x} ${p1.y}`;
    }

    if (closeArea) {
      d += ` L 100 100 L 0 100 Z`;
    }

    return d;
  }

  linePath = computed(() => this.getPath(this.data(), false));
  areaPath = computed(() => this.getPath(this.data(), true));
}