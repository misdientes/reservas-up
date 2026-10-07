# Imagen Open Graph

`public/og-image.png` (1200×630) es la vista previa del sitio al compartir el enlace por WhatsApp o redes. Se genera desde `og-image.html`, que usa solo los tokens Costa y Pampa.

Regenerar (requiere Microsoft Edge; sin dependencias del proyecto):

```
node scripts/capture.mjs "file:///C:/Users/PC%20Dr%20Gil/reservas-up/scripts/og/og-image.html" 1200 public/og-image.png --h=630
```

La ruta `file:///` va codificada (`PC%20Dr%20Gil`) porque la carpeta tiene espacios. WhatsApp guarda en caché las vistas previas: si cambias la imagen, puede tardar en verse actualizada.
