# Convertisseur Local

Application Windows de conversion de fichiers construite avec React, Tauri 2 et Rust. Les fichiers sont traités sur l’ordinateur et ne sont envoyés vers aucun service distant.

![Aperçu de Convertisseur Local](docs/preview.png)

## Installation

[Téléchargez la dernière version Windows](https://github.com/AurelienBascobert/convertisseur-local/releases/latest), puis lancez `Convertisseur-Local-0.2.0-x64-Setup.exe`. Les moteurs de conversion sont déjà inclus dans l’installeur : aucune dépendance supplémentaire n’est nécessaire.

L’installeur communautaire n’étant pas signé par un certificat commercial, Windows peut afficher un avertissement « Éditeur inconnu ».

## Fonctionnalités du MVP

- ajout de plusieurs fichiers par glisser-déposer ou avec le sélecteur Windows ;
- détection du type réel grâce à la signature du fichier ;
- conversion d’images en PNG, JPEG, WebP, BMP, TIFF ou ICO avec Rust ;
- conversion audio et vidéo via FFmpeg intégré ;
- conversion de documents entre DOCX, Markdown, HTML, EPUB, TXT et LaTeX via Pandoc intégré ;
- création de PDF à partir de documents via Pandoc et Typst intégrés ;
- file d’attente, états de progression, annulation et noms de sortie sans écrasement ;
- choix du dossier de destination ;
- interface entièrement locale en français.

## Prérequis Windows

1. Node.js et pnpm ;
2. Rust avec la cible MSVC ;
3. Microsoft C++ Build Tools, avec la charge de travail « Développement Desktop en C++ » ;
4. WebView2, généralement déjà présent sur Windows 10 et 11 ;

Avant de compiler le projet cloné, préparez les moteurs intégrés :

```powershell
.\scripts\prepare-ffmpeg.ps1
.\scripts\prepare-document-engines.ps1
```

FFmpeg, Pandoc et Typst sont intégrés au paquet Windows : l’utilisateur final n’a rien à installer séparément.

> Le PDF est actuellement un format de sortie. La conversion d’un PDF existant vers un format éditable n’est pas encore proposée.

## Lancer l’application

```powershell
pnpm install
pnpm tauri dev
```

## Construire l’installeur Windows

```powershell
pnpm tauri build
```

Le résultat sera créé dans `src-tauri/target/release/bundle`.

## Contrôles disponibles

```powershell
pnpm build
cd src-tauri
cargo test
```

## Suite recommandée

FFmpeg 9.0.1 Essentials, Pandoc 3.11 et Typst 0.15.1 sont distribués comme sidecars. Leurs licences et les liens vers les codes sources correspondants sont inclus dans `src-tauri/third-party`.

La prochaine étape fonctionnelle consiste à ajouter la conversion des archives et, plus tard, l’import de PDF vers des formats éditables.
