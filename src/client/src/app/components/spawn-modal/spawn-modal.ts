import { Component, inject, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Dialog } from 'primeng/dialog';
import { Button } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { Textarea } from 'primeng/textarea';
@Component({
  selector: 'app-spawn-modal',
  standalone: true,
  imports: [Dialog, Button, InputText, Textarea, FormsModule],
  templateUrl: './spawn-modal.html',
  styleUrl: './spawn-modal.css',
})
export class SpawnModal {
  visible = model<boolean>(false);

  name = '';
  prompt = '';
  cwd = '';

  spawn(): void {
    // No-op — hooks mode doesn't spawn from UI
    this.reset();
    this.visible.set(false);
  }

  reset(): void {
    this.name = '';
    this.prompt = '';
    this.cwd = '';
  }

  onHide(): void {
    this.reset();
  }
}
