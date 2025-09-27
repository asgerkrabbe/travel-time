/*
 * Frontend logic for the photo gallery. Fetches the list of images from the
 * server, renders them in a responsive grid and handles the upload modal.
 */

document.addEventListener('DOMContentLoaded', () => {
  const galleryEl = document.getElementById('gallery');
  const uploadButton = document.getElementById('uploadButton');
  const modalEl = document.getElementById('modal');
  const closeModal = document.getElementById('closeModal');
  const cancelUpload = document.getElementById('cancelUpload');
  const uploadForm = document.getElementById('uploadForm');
  const toastEl = document.getElementById('toast');
  const prefix = window.location.pathname.startsWith('/photos') ? '/photos' : '';
  const imageModal = document.getElementById('imageModal');
  const closeImageModal = document.getElementById('closeImageModal');
  const modalImage = document.getElementById('modalImage');

  // Fetch the list of image filenames and render them into the gallery.
  async function loadGallery() {
    try {
      const response = await fetch(`${prefix}/api/photos`);
      if (!response.ok) {
        throw new Error('Failed to fetch photos');
      }
      const files = await response.json();
      galleryEl.innerHTML = '';
      files.forEach(file => {
        const img = document.createElement('img');
        img.src = `${prefix}/files/${encodeURIComponent(file)}`;
        img.alt = file;
        img.loading = 'lazy';
        img.tabIndex = 0;
        img.addEventListener('click', () => openImageModal(img.src, img.alt));
        img.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') {
            openImageModal(img.src, img.alt);
          }
        });
        galleryEl.appendChild(img);
      });
    } catch (err) {
      showToast(err.message || 'Error loading gallery', true);
    }
  }

  // Display a temporary toast message. Errors are shown in red.
  function showToast(message, isError = false) {
    toastEl.textContent = message;
    if (isError) {
      toastEl.classList.add('error');
    } else {
      toastEl.classList.remove('error');
    }
    toastEl.classList.add('show');
    setTimeout(() => {
      toastEl.classList.remove('show');
    }, 3000);
  }

  function openModal() {
    modalEl.classList.remove('hidden');
    modalEl.setAttribute('aria-hidden', 'false');
    document.getElementById('token').focus();
  }

  function closeModalFunc() {
    modalEl.classList.add('hidden');
    modalEl.setAttribute('aria-hidden', 'true');
    uploadForm.reset();
  }

  // Open image modal with the clicked image
  function openImageModal(src, alt) {
    modalImage.src = src;
    modalImage.alt = alt || 'Preview';
    imageModal.classList.remove('hidden');
    imageModal.setAttribute('aria-hidden', 'false');
    closeImageModal.focus();
  }

  // Close image modal
  function closeImageModalFunc() {
    imageModal.classList.add('hidden');
    imageModal.setAttribute('aria-hidden', 'true');
    modalImage.src = '';
  }

  // Show modal on upload button click
  uploadButton.addEventListener('click', () => {
    openModal();
  });

  // Hide modal on close and cancel click
  if (closeModal) {
    closeModal.addEventListener('click', closeModalFunc);
  }

  cancelUpload.addEventListener('click', () => {
    closeModalFunc();
  });

  // Handle form submission for file upload
  uploadForm.addEventListener('submit', event => {
    event.preventDefault();
    const tokenInput = document.getElementById('token');
    const fileInput = document.getElementById('photo');
    const token = tokenInput.value.trim();
    const file = fileInput.files[0];
    if (!file) {
      showToast('Please select an image to upload', true);
      return;
    }
    const formData = new FormData();
    formData.append('photo', file);
    fetch(`${prefix}/api/upload`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token
      },
      body: formData
    })
      .then(response => {
        if (!response.ok) {
          return response.json().then(err => { throw err; });
        }
        return response.json();
      })
      .then(() => {
        showToast('Upload successful');
        closeModalFunc();
        loadGallery();
      })
      .catch(error => {
        const message = error && error.error ? error.error : 'Upload failed';
        showToast(message, true);
      });
  });

  // Close image modal on close button click
  closeImageModal.addEventListener('click', closeImageModalFunc);

  // Close image modal on click outside image
  imageModal.addEventListener('click', e => {
    if (e.target === imageModal) {
      closeImageModalFunc();
    }
  });

  // Close image modal on Escape key
  document.addEventListener('keydown', event => {
    if (imageModal.getAttribute('aria-hidden') === 'false' && event.key === 'Escape') {
      event.preventDefault();
      closeImageModalFunc();
    }
  });

  // Global keyboard shortcuts: press 'u' to open the upload modal and 'Escape' to close it
  document.addEventListener('keydown', event => {
    if ((event.key === 'u' || event.key === 'U') && modalEl.getAttribute('aria-hidden') === 'true') {
      event.preventDefault();
      openModal();
    } else if (event.key === 'Escape' && modalEl.getAttribute('aria-hidden') === 'false') {
      event.preventDefault();
      closeModalFunc();
    }
  });

  // Initial load
  loadGallery();
});
