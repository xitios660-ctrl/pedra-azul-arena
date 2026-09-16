# Pedra Azul Futsal 3D

Esta pasta guarda o master 3D reproduzível da arena de futsal usada como direção visual do fundo da home.

## Render

Com Blender 4.x instalado:

```bash
blender -b -P blender/pedra_azul_futsal_loop.py
```

O script cria a quadra, gols, iluminação de arena, jogadores low-poly, goleiro, bola, passes, finalização e câmera em loop. O vídeo é renderizado para:

```
frontend/public/assets/video/pedra-azul-blender-loop.mp4
```

A versão publicada do site usa uma camada Canvas em tempo real sobre o vídeo-base para manter carregamento leve, movimento fluido e compatibilidade mobile. O áudio de quadra é sintetizado no navegador após interação do visitante, respeitando as regras de autoplay do iOS e demais navegadores.
