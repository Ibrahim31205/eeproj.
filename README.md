# eeproj.
Browser workbench for Digital logic, Scope/fft, 8-bit CPU, EM Fields and Pathfinding

Live website link : https://ibrahim31205.github.io/eeproj./

1.Digital logic:-
Drag and drop gate sandbox (IN, CLK, AND, OR, NOT, NAND, XOR, LED, and a 4-bit Hex display). Runs a few propagation passes per frame. Circuits can be copied/loaded as JSON.

2.Scope/FFT:-
Simple waveform generator and low-pass filter hooked up to a rising edge triggered scope and an FFT plot (0–10 kHz). Also has a mic mode if you want to look at room audio/voice, routed straight to the analyser so it doesn't blast feedback through your speakers.

3.8-Bit CPU:-
Tiny 8-bit CPU with 4 registers (R0-R3) and 32 bytes of RAM. Comes with a basic assembler (MOV, ADD, SUB, LD ,ST, CMP, Jumps, HLT) and a few starter programs like fibonacci and pointer copying. Mostly built this to see bus transfers and indirect addressing [R3] step by step.

4.EM Fields and Pathfinding:-
Grid visualizer for A*, Dijkstra, and BFS (with a recursive maze generator), plus a small 2-6-1 neural net that trains live on XOR, circle, and spiral points.
