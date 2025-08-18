/*
 * Frontend logic for the photo gallery. Fetches the list of images from the
 * server, renders them in a responsive grid and handles the upload modal.
 */

document.addEventListener('DOMContentLoaded', () => {
  const galleryEl = document.getElementById('gallery');
  const modalEl = document.getElementById('modal');
  const uploadButton = document.getElementById('uploadButton');
  const cancelButton = document.getElementById('cancelUpload');
  const uploadForm = document.getElementById('uploadForm');
  const toastEl = document.getElementById('toast');

  /**
   * Fetch the list of image filenames and render them into the gallery.
   */
  function loadGallery() {
    fetch('/api/photos')
      .then(response => {
        if (!response.ok) {
          throw new Error('Failed to fetch photos');
        }
        return response.json();
      })
      .then(files => {
        galleryEl.innerHTML = '';
        files.forEach(file => {
          const img = document.createElement('img');
          img.src = `/files/${encodeURIComponent(file)}`;
          img.alt = file;
          img.loading = 'lazy';
          galleryEl.appendChild(img);
        });
      })
      .catch(error => {
        showToast(error.message || 'Error loading gallery', true);
      });
  }

  /**
   * Display a temporary toast message. Errors are shown in red.
   *
   * @param {string} message
   * @param {boolean} isError
   */
  function showToast(message, isError = false) {
    toastEl.textContent = message;
    toastEl.style.backgroundColor = isError ? '#dc3545' : '#333';
    toastEl.classList.add('show');
    setTimeout(() => {
      toastEl.classList.remove('show');
    }, 3000);
  }

  // Show modal on upload button click
  uploadButton.addEventListener('click', () => {
    modalEl.classList.remove('hidden');
    document.getElementById('token').focus();
  });

  // Hide modal on cancel button click
  cancelButton.addEventListener('click', () => {
    modalEl.classList.add('hidden');
    uploadForm.reset();
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
    fetch('/api/upload', {
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
      .then(data => {
        showToast('Upload successful');
        modalEl.classList.add('hidden');
        uploadForm.reset();
        loadGallery();
      })
      .catch(error => {
        const message = error && error.error ? error.error : 'Upload failed';
        showToast(message, true);
      });
  });

  // Initial load
  loadGallery();
});