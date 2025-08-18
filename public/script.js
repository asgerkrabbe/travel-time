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

  // Fetch the list of image filenames and render them into the gallery.
  async function loadGallery() {
    try {
      const response = await fetch('api/photos');
      if (!response.ok) {
        throw new Error('Failed to fetch photos');
      }
      const files = await response.json();
      galleryEl.innerHTML = '';
      files.forEach(file => {
        const img = document.createElement('img');
        img.src = `files/${encodeURIComponent(file)}`;
        img.alt = file;
        img.loading = 'lazy';
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
    modalEl.setAttribute('aria-hidden', 'false');
    document.getElementById('token').focus();
  }

  function closeModalFunc() {
    modalEl.setAttribute('aria-hidden', 'true');
    uploadForm.reset();
  }

  // Show modal on upload button click
  uploadButton.addEventListener('click', () => {
    openModal();
  });

  // Hide modal on close and cancel click
  closeModal.addEventListener('click', () => {
    closeModalFunc();
  });

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
    fetch('api/upload', {
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
