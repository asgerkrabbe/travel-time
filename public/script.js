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
      const response = await fetch(`${prefix}/api/photos?meta=1`);
      if (!response.ok) {
        throw new Error('Failed to fetch photos');
      }
      const payload = await response.json();
      galleryEl.innerHTML = '';
      // Support two payload shapes:
      // 1) ["file1.jpg", ...]
      // 2) [{ original: "file1.jpg", thumb: "file1.thumb.jpg" | null, date_taken?: string }, ...]
      const items = Array.isArray(payload)
        ? (typeof payload[0] === 'string' || payload.length === 0
            ? payload.map(p => ({ original: p, thumb: null, date_taken: null }))
            : payload)
        : [];
      
      let lastMonthYear = null;
      
      items.forEach(item => {
        const original = item && typeof item.original === 'string' ? item.original : String(item);
        const thumb = item && typeof item.thumb === 'string' ? item.thumb : null;
        const dateTaken = item && typeof item.date_taken === 'string' ? item.date_taken : null;
        
        // Format date as DD/MM/YYYY
        let dateLabel = '';
        let photoDate = null;
        if (dateTaken) {
          photoDate = new Date(dateTaken);
          // Validate that the date is valid
          if (!isNaN(photoDate.getTime())) {
            const day = String(photoDate.getDate()).padStart(2, '0');
            const month = String(photoDate.getMonth() + 1).padStart(2, '0');
            const year = photoDate.getFullYear();
            dateLabel = `${day}/${month}/${year}`;
          } else {
            // Invalid date, reset photoDate to null
            photoDate = null;
          }
        }

        // Insert month/year divider if month changed
        if (photoDate) {
          const monthYear = `${photoDate.getFullYear()}-${photoDate.getMonth()}`;
          if (monthYear !== lastMonthYear) {
            const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                                'July', 'August', 'September', 'October', 'November', 'December'];
            const divider = document.createElement('div');
            divider.className = 'month-divider';
            divider.textContent = `${monthNames[photoDate.getMonth()]} - ${photoDate.getFullYear()}`;
            galleryEl.appendChild(divider);
            lastMonthYear = monthYear;
          }
        }

        const figure = document.createElement('figure');
        figure.className = 'photo-item';

        const img = document.createElement('img');
        // Prefer serving thumbnails; if API only returned originals, we can also
        // request /files/thumbs by original name thanks to server-side mapping.
        img.src = thumb
          ? `${prefix}/files/thumbs/${encodeURIComponent(thumb)}`
          : `${prefix}/files/thumbs/${encodeURIComponent(original)}`;
        img.alt = original;
        img.loading = 'lazy';
        img.tabIndex = 0;
        if (dateLabel) {
          img.title = dateLabel;
          img.setAttribute('aria-label', `Photo taken ${dateLabel}`);
          img.dataset.dateTaken = dateTaken;
        }
        // If the thumb 404s for some reason, fall back to original
        img.onerror = () => {
          if (img.src.includes('/files/thumbs/')) {
            img.onerror = null;
            img.src = `${prefix}/files/${encodeURIComponent(original)}`;
          }
        };
        // Open full original in lightbox
        const originalUrl = `${prefix}/files/${encodeURIComponent(original)}`;
        img.addEventListener('click', () => openImageModal(originalUrl, img.alt));
        img.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') {
            openImageModal(originalUrl, img.alt);
          }
        });

        const caption = document.createElement('figcaption');
        caption.className = 'caption';
        caption.textContent = dateLabel || 'Unknown';

        figure.appendChild(img);
        figure.appendChild(caption);
        galleryEl.appendChild(figure);
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
    const files = Array.from(fileInput.files || []);
    if (!files.length) {
      showToast('Please select image(s) to upload', true);
      return;
    }
    const formData = new FormData();
    for (const f of files) {
      formData.append('photo', f);
    }
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
      .then((result) => {
        if (result && result.success) {
          const uploaded = (result.items || []).length;
          const failed = (result.errors || []).length;
          let msg = `Uploaded ${uploaded}`;
          if (failed) msg += `, ${failed} failed`;
          showToast(msg);
        } else {
          const message = result && result.error ? result.error : 'Upload failed';
          showToast(message, true);
        }
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
